// Telegram integration over MTProto (GramJS). The Bot API can neither list an
// account's chats nor comment as the user, so this talks to Telegram as the account
// itself, using a session obtained by a normal phone-code login.

const { TelegramClient, Api } = require("telegram");
const { StringSession } = require("telegram/sessions");
const { returnBigInt } = require("telegram/Helpers");
const utils = require("telegram/Utils");
const { encrypt, decrypt } = require("./cryptoService");
const limits = require("./telegramLimits");

const IDLE_DISCONNECT_MS = 10 * 60 * 1000;

// Errors after which the stored session can never work again — the account has to
// log in from scratch.
const DEAD_SESSION_ERRORS = [
  "AUTH_KEY_UNREGISTERED",
  "AUTH_KEY_DUPLICATED",
  "SESSION_REVOKED",
  "SESSION_EXPIRED",
  "USER_DEACTIVATED",
  "USER_DEACTIVATED_BAN",
];

// accountId -> { promise, timer }. One live connection per account, dropped after
// it has been idle for a while.
const clients = new Map();
// Accounts whose connection must stay open (they listen for incoming messages),
// so the idle timer never closes it.
const pinned = new Set();

function getCredentials(account) {
  const apiId = Number(account.apiId || process.env.TELEGRAM_API_ID);
  const apiHash = account.apiHashEncrypted
    ? decrypt(account.apiHashEncrypted)
    : process.env.TELEGRAM_API_HASH;
  if (!apiId || !apiHash) {
    throw new Error(
      "Telegram API credentials are not set (TELEGRAM_API_ID/TELEGRAM_API_HASH in .env or apiId/apiHash on the account)",
    );
  }
  return { apiId, apiHash };
}

// Copies the .env api_id/api_hash onto an account that has none, so the account
// keeps using the same app credentials even if .env changes later. Returns
// whether anything changed (the caller saves).
function pinCredentials(account) {
  if (account.apiId && account.apiHashEncrypted) return false;
  const apiId = Number(process.env.TELEGRAM_API_ID);
  const apiHash = process.env.TELEGRAM_API_HASH;
  if (!apiId || !apiHash) {
    const err = new Error(
      "Telegram API credentials are not set: add TELEGRAM_API_ID and TELEGRAM_API_HASH to backend/.env",
    );
    err.status = 500;
    throw err;
  }
  account.apiId = apiId;
  account.apiHashEncrypted = encrypt(apiHash);
  return true;
}

async function connect(account) {
  const { apiId, apiHash } = getCredentials(account);
  const session = new StringSession(
    account.sessionEncrypted ? decrypt(account.sessionEncrypted) : "",
  );
  const client = new TelegramClient(session, apiId, apiHash, {
    connectionRetries: 3,
    // Anything longer than a few seconds is reported to the caller instead of
    // silently holding the HTTP request open.
    floodSleepThreshold: 5,
  });
  // "info" or "debug" shows GramJS's own connection / DC-switch logging.
  client.setLogLevel(process.env.TELEGRAM_LOG_LEVEL || "error");
  await client.connect();
  return client;
}

function getClient(account) {
  const key = String(account._id);
  let entry = clients.get(key);
  if (!entry) {
    entry = { promise: connect(account), timer: null };
    clients.set(key, entry);
    const created = entry;
    created.promise.catch(() => {
      if (clients.get(key) === created) clients.delete(key);
    });
  }
  clearTimeout(entry.timer);
  entry.timer = null;
  if (!pinned.has(key)) {
    entry.timer = setTimeout(() => dropClient(key), IDLE_DISCONNECT_MS);
    entry.timer.unref();
  }
  return entry.promise;
}

// Keeps (or stops keeping) the account's connection open regardless of activity.
function pinClient(accountId, keepOpen) {
  const key = String(accountId);
  if (keepOpen) pinned.add(key);
  else pinned.delete(key);
  const entry = clients.get(key);
  if (!entry) return;
  clearTimeout(entry.timer);
  entry.timer = null;
  if (!keepOpen) {
    entry.timer = setTimeout(() => dropClient(key), IDLE_DISCONNECT_MS);
    entry.timer.unref();
  }
}

async function dropClient(accountId) {
  const key = String(accountId);
  const entry = clients.get(key);
  if (!entry) return;
  clients.delete(key);
  clearTimeout(entry.timer);
  try {
    const client = await entry.promise;
    await client.destroy();
  } catch {
    // Never connected or already gone — nothing to close.
  }
}

async function withClient(account, fn) {
  const client = await getClient(account);
  try {
    return await fn(client);
  } catch (err) {
    if (DEAD_SESSION_ERRORS.includes(err.errorMessage)) {
      account.authStatus = "failed";
      account.authError = err.errorMessage;
      account.authCheckedAt = new Date();
      await account.save();
      await dropClient(account._id);
    }
    throw err;
  }
}

function usernameOf(entity) {
  return entity?.username || entity?.usernames?.[0]?.username || "";
}

// Chats are addressed by the "marked" id from listChats (e.g. -1001234567890) or by
// @username / t.me link.
function toChatRef(chatRef) {
  const value = String(chatRef).trim();
  return /^-?\d+$/.test(value) ? returnBigInt(value) : value;
}

async function resolvePeer(client, chatRef) {
  const ref = toChatRef(chatRef);
  try {
    return await client.getInputEntity(ref);
  } catch (err) {
    // A StringSession keeps no entity cache between restarts, so a numeric id is
    // unknown until the dialog list has been loaded once on this connection.
    await client.getDialogs({});
    return client.getInputEntity(ref);
  }
}

// ---------- session ----------

// Ends the session on Telegram's side too, so no orphaned login is left behind.
async function logOut(account) {
  if (account.sessionEncrypted) {
    try {
      const client = await getClient(account);
      await client.invoke(new Api.auth.LogOut());
    } catch {
      // Session already invalid or Telegram unreachable — it is discarded locally anyway.
    }
  }
  await dropClient(account._id);
}

// ---------- account data ----------

async function refreshProfile(account) {
  await withClient(account, async (client) => {
    const me = await client.getMe();
    const full = await client.invoke(
      new Api.users.GetFullUser({ id: new Api.InputUserSelf() }),
    );
    account.profile = {
      telegramId: String(me.id),
      username: usernameOf(me),
      firstName: me.firstName || "",
      lastName: me.lastName || "",
      phone: me.phone || "",
      about: full.fullUser?.about || "",
      premium: Boolean(me.premium),
    };
  });
  account.authStatus = "authorized";
  account.authError = "";
  account.authCheckedAt = new Date();
  await account.save();
  return account;
}

// ---------- chats ----------

function chatType(entity) {
  if (entity.className !== "Channel") return "group";
  return entity.broadcast ? "channel" : "supergroup";
}

function toChatSummary(entity) {
  return {
    id: String(utils.getPeerId(entity)),
    title: entity.title || "",
    username: usernameOf(entity),
    type: chatType(entity),
    membersCount: entity.participantsCount ?? null,
    // On a channel: it has a discussion group where post comments live.
    // On a supergroup: it is such a discussion group.
    hasLinkedChat: Boolean(entity.hasLink),
    // Supergroup split into topics; every topic is a reply thread of its own.
    forum: Boolean(entity.forum),
  };
}

// Every group, supergroup and channel the account is a member of, archived ones
// included, most recently active first.
async function listChats(account) {
  return withClient(account, async (client) => {
    const dialogs = await client.getDialogs({});
    return dialogs
      .filter(
        ({ entity }) =>
          entity &&
          (entity.className === "Channel" || entity.className === "Chat") &&
          !entity.left &&
          !entity.deactivated,
      )
      .map((dialog) => ({
        ...toChatSummary(dialog.entity),
        unreadCount: dialog.unreadCount ?? 0,
        lastMessageDate: toDate(dialog.date),
        archived: Boolean(dialog.archived),
      }));
  });
}

// Full info for one chat, including the discussion group linked to a channel.
async function getChat(account, chatRef) {
  return withClient(account, async (client) => {
    const peer = await resolvePeer(client, chatRef);
    if (peer.className !== "InputPeerChannel") {
      const entity = await client.getEntity(peer);
      return { ...toChatSummary(entity), about: "", linkedChat: null };
    }
    const full = await client.invoke(
      new Api.channels.GetFullChannel({ channel: peer }),
    );
    const findChat = (id) =>
      id ? full.chats.find((chat) => String(chat.id) === String(id)) : null;
    const linked = findChat(full.fullChat.linkedChatId);
    return {
      ...toChatSummary(findChat(full.fullChat.id)),
      about: full.fullChat.about || "",
      membersCount: full.fullChat.participantsCount ?? null,
      linkedChat: linked ? toChatSummary(linked) : null,
    };
  });
}

// ---------- posts & comments ----------

function toDate(unixSeconds) {
  return unixSeconds ? new Date(unixSeconds * 1000).toISOString() : null;
}

// An error the controller reports as 400: the request makes no sense for this
// chat, so Telegram is never asked.
function badRequest(message) {
  const err = new Error(message);
  err.status = 400;
  return err;
}

function messageUrl(message) {
  const channelId = message.peerId?.channelId;
  if (!channelId) return "";
  const username = usernameOf(message.chat);
  return username
    ? `https://t.me/${username}/${message.id}`
    : `https://t.me/c/${channelId}/${message.id}`;
}

function mediaType(message) {
  if (!message.media) return null;
  if (message.photo) return "photo";
  if (message.gif) return "gif";
  if (message.videoNote) return "video_note";
  if (message.video) return "video";
  if (message.voice) return "voice";
  if (message.audio) return "audio";
  if (message.sticker) return "sticker";
  if (message.poll) return "poll";
  if (message.webPreview) return "link";
  if (message.geo) return "location";
  if (message.contact) return "contact";
  if (message.document) return "document";
  return "other";
}

function reactionsCount(message) {
  return (message.reactions?.results || []).reduce(
    (sum, reaction) => sum + (reaction.count || 0),
    0,
  );
}

function authorOf(message) {
  // Signed channel posts carry the admin's name; otherwise the sender is a user
  // (groups) or the channel itself.
  if (message.postAuthor) return message.postAuthor;
  return message.sender ? utils.getDisplayName(message.sender) : "";
}

// Where the replies to a message live, if anywhere:
//  - "comments": a channel post with a linked discussion group;
//  - "replies":  a supergroup message, since any of them can root a thread;
//  - null:       a channel post with comments off, or a basic group (no threads).
function threadKind(message) {
  if (message.post) return message.replies?.comments ? "comments" : null;
  return message.peerId?.className === "PeerChannel" ? "replies" : null;
}

function toPost(message, album = [message]) {
  const kind = threadKind(message);
  const textMessage = album.find((m) => m.message) || message;
  const mediaMessage = album.find((m) => m.media) || message;
  return {
    id: message.id,
    date: toDate(message.date),
    editDate: toDate(message.editDate),
    text: textMessage.message || "",
    author: authorOf(message),
    authorUsername: message.post ? "" : usernameOf(message.sender),
    hasMedia: Boolean(mediaMessage.media),
    mediaType: mediaType(mediaMessage),
    mediaCount: album.filter((m) => m.media).length,
    views: message.views ?? null,
    forwards: message.forwards ?? null,
    reactions: reactionsCount(message),
    pinned: Boolean(message.pinned),
    own: Boolean(message.out),
    forwarded: Boolean(message.fwdFrom),
    replyToId: message.replyTo?.replyToMsgId ?? null,
    threadKind: kind,
    commentsEnabled: Boolean(kind),
    commentsCount: message.replies?.replies ?? 0,
    discussionChatId: message.replies?.channelId
      ? String(
          utils.getPeerId(
            new Api.PeerChannel({ channelId: message.replies.channelId }),
          ),
        )
      : null,
    url: messageUrl(message),
  };
}

// An album arrives as several messages sharing one groupedId, and only one of them
// carries the comment thread. They are folded into a single post.
function foldAlbums(messages) {
  const groups = [];
  const albums = new Map();
  for (const message of messages) {
    const groupId = message.groupedId ? String(message.groupedId) : null;
    if (!groupId) {
      groups.push([message]);
      continue;
    }
    if (!albums.has(groupId)) {
      albums.set(groupId, []);
      groups.push(albums.get(groupId));
    }
    albums.get(groupId).push(message);
  }
  return groups.map((album) => {
    const main =
      album.find((m) => m.replies) ||
      album.find((m) => m.message) ||
      album[album.length - 1];
    return toPost(main, album);
  });
}

// Telegram pages backwards: the next page starts below the oldest id seen. A short
// page means the history is exhausted.
function nextOffset(messages, limit) {
  if (messages.length < limit) return null;
  return Math.min(...messages.map((m) => m.id));
}

// Latest posts (channel) or messages (group), newest first. Passing the previous
// response's nextOffsetId as offsetId returns the page before it.
async function listPosts(account, chatRef, { limit = 20, offsetId = 0 } = {}) {
  return withClient(account, async (client) => {
    const peer = await resolvePeer(client, chatRef);
    const messages = await client.getMessages(peer, { limit, offsetId });
    // Service messages (pins, joins, title changes, ...) are not posts.
    const real = messages.filter((m) => m.className === "Message");
    return {
      items: foldAlbums(real),
      nextOffsetId: nextOffset(messages, limit),
    };
  });
}

function toComment(message) {
  const sender = message.sender;
  const replyTo = message.replyTo;
  return {
    id: message.id,
    date: toDate(message.date),
    editDate: toDate(message.editDate),
    text: message.message || "",
    hasMedia: Boolean(message.media),
    mediaType: mediaType(message),
    author: sender ? utils.getDisplayName(sender) : "",
    authorUsername: usernameOf(sender),
    authorId: message.senderId ? String(message.senderId) : null,
    reactions: reactionsCount(message),
    // Set when this comment answers another comment rather than the post itself.
    replyToId: replyTo?.replyToTopId ? (replyTo.replyToMsgId ?? null) : null,
    own: Boolean(message.out),
  };
}

function assertThreadsSupported(peer) {
  if (peer.className === "InputPeerChat") {
    throw badRequest(
      "Basic groups have no reply threads, only channels and supergroups do",
    );
  }
}

// Comments under a channel post (read from its discussion group) or replies in a
// supergroup message's thread, newest first, paged like listPosts.
async function listComments(
  account,
  chatRef,
  postId,
  { limit = 30, offsetId = 0 } = {},
) {
  return withClient(account, async (client) => {
    const peer = await resolvePeer(client, chatRef);
    assertThreadsSupported(peer);
    const messages = await client.getMessages(peer, {
      replyTo: postId,
      limit,
      offsetId,
    });
    return {
      items: messages.filter((m) => m.className === "Message").map(toComment),
      total: messages.total ?? null,
      nextOffsetId: nextOffset(messages, limit),
    };
  });
}

// When the account joined a channel/supergroup, or null (not a member, or the
// creator, for whom Telegram keeps no date).
async function selfJoinDate(client, peer) {
  if (peer.className !== "InputPeerChannel") return null;
  const res = await client.invoke(
    new Api.channels.GetParticipant({ channel: peer, participant: new Api.InputPeerSelf() }),
  );
  const date = res.participant?.date;
  return date ? new Date(date * 1000) : null;
}

// `source`: "manual" (typed in the UI) or "auto"; both count toward the
// account's activity limits (services/telegramLimits.js).
async function sendComment(account, chatRef, postId, text, { source = "auto" } = {}) {
  return withClient(account, async (client) => {
    const peer = await resolvePeer(client, chatRef);
    assertThreadsSupported(peer);
    const entity = await client.getEntity(peer);
    const chatId = String(utils.getPeerId(peer));
    const op = {
      kind: "chat",
      chatId,
      texts: [text],
      joinedAt: await limits.joinedAt(account, chatId, () => selfJoinDate(client, peer)),
    };
    const sent = await limits.guard(
      account,
      op,
      () =>
        client.sendMessage(peer, {
          message: text,
          // A channel post is answered in its discussion group, a group message in place.
          ...(entity.broadcast ? { commentTo: postId } : { replyTo: postId }),
          // Send the text exactly as typed instead of interpreting it as markdown.
          parseMode: false,
        }),
      { source },
    );
    if (sent) return toComment(sent);

    // Telegram accepted the message (no error), but GramJS could not map its answer
    // back to it and returned undefined — this happens with comments, which land in
    // the discussion group rather than in the channel that was addressed. Treating
    // it as a failure would make the auto-commenter comment the same post again, so
    // the comment is looked up in the thread instead.
    console.warn(
      `[telegram] comment to post ${postId} in ${chatRef} sent, but Telegram's answer could not be mapped; looking it up`,
    );
    try {
      const recent = await client.getMessages(peer, { replyTo: postId, limit: 10 });
      const mine = recent.find(
        (m) => m.className === "Message" && m.out && (m.message || "") === text,
      );
      if (mine) return toComment(mine);
    } catch (err) {
      console.warn(`[telegram] looking up the sent comment failed: ${err.errorMessage || err.message}`);
    }
    return {
      id: null,
      date: new Date().toISOString(),
      editDate: null,
      text,
      hasMedia: false,
      mediaType: null,
      author: "",
      authorUsername: "",
      authorId: null,
      reactions: 0,
      replyToId: null,
      own: true,
      // Sent, but its id is unknown.
      unconfirmed: true,
    };
  });
}

// ---------- joining chats ----------

// Invite hash from "https://t.me/+AbC", "t.me/joinchat/AbC", "tg://join?invite=AbC"
// or "+AbC"; null for a public @username / t.me/name link.
function inviteHash(ref) {
  const value = String(ref).trim();
  const m =
    value.match(/(?:t\.me|telegram\.me)\/(?:\+|joinchat\/)([\w-]+)/i) ||
    value.match(/tg:\/\/join\?invite=([\w-]+)/i) ||
    value.match(/^\+([\w-]+)$/);
  return m ? m[1] : null;
}

function publicName(ref) {
  const value = String(ref).trim();
  const m = value.match(/(?:t\.me|telegram\.me)\/([A-Za-z0-9_]{4,})/i);
  return m ? m[1] : value.replace(/^@/, "");
}

// Channels and supergroups the account is in now (Telegram caps these at 500).
async function countChannels(client) {
  const dialogs = await client.getDialogs({});
  return dialogs.filter(
    ({ entity }) => entity?.className === "Channel" && !entity.left,
  ).length;
}

// Joins a group or channel by @username, t.me link or invite link, within the
// account's join limits. Returns { status: "joined" | "requested" | "already", chat }.
async function joinChat(account, chatRef, { source = "manual" } = {}) {
  const ref = String(chatRef || "").trim();
  if (!ref) throw badRequest("Вкажіть @username, посилання t.me або посилання-запрошення");
  return withClient(account, async (client) => {
    const hash = inviteHash(ref);
    let entity = null;
    if (hash) {
      const invite = await client.invoke(new Api.messages.CheckChatInvite({ hash }));
      if (invite.className === "ChatInviteAlready") {
        return { status: "already", chat: toChatSummary(invite.chat) };
      }
      if (invite.className === "ChatInvitePeek") entity = invite.chat;
    } else {
      entity = await client.getEntity(publicName(ref));
      if (entity.className !== "Channel" && entity.className !== "Chat") {
        throw badRequest("Це не група і не канал");
      }
      if (entity.className === "Channel" && entity.left === false) {
        return { status: "already", chat: toChatSummary(entity) };
      }
    }

    const chatId = entity ? String(utils.getPeerId(entity)) : `invite:${hash}`;
    const q = limits.effectiveLimits(account).quotas;
    const op = {
      kind: "join",
      chatId,
      channelCount: q.enabled && q.maxChannels ? await countChannels(client) : null,
    };
    let status = "joined";
    const updates = await limits
      .guard(
        account,
        op,
        async () => {
          try {
            const res = hash
              ? await client.invoke(new Api.messages.ImportChatInvite({ hash }))
              : await client.invoke(new Api.channels.JoinChannel({ channel: entity }));
            // The join is recorded under the chat's real id, so "recently
            // joined" works for chats joined by invite link too.
            if (res?.chats?.[0]) op.chatId = String(utils.getPeerId(res.chats[0]));
            return res;
          } catch (err) {
            // Join request sent to a chat that approves members: it counts as a
            // join attempt all the same.
            if (err.errorMessage === "INVITE_REQUEST_SENT") {
              status = "requested";
              return null;
            }
            throw err;
          }
        },
        { source },
      )
      .catch((err) => {
        if (err.errorMessage === "USER_ALREADY_PARTICIPANT") {
          status = "already";
          return null;
        }
        throw err;
      });
    const chat = updates?.chats?.[0] || entity;
    return { status, chat: chat ? toChatSummary(chat) : null };
  });
}

// Logging in (code, QR, session import, 2FA) lives in telegramAuth.js.
module.exports = {
  getClient,
  withClient,
  pinClient,
  dropClient,
  getCredentials,
  pinCredentials,
  logOut,
  refreshProfile,
  listChats,
  getChat,
  listPosts,
  listComments,
  sendComment,
  joinChat,
};
