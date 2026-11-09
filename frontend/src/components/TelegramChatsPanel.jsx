import { Fragment, useEffect, useRef, useState } from 'react';
import {
  fetchTelegramChats,
  fetchTelegramChat,
  fetchTelegramPosts,
  fetchTelegramComments,
  sendTelegramComment,
} from '../api/telegram';
import { errorMessage } from '../api/client';
import { formatDate } from './StatusBadge';

const POSTS_PAGE = 20;
const COMMENTS_PAGE = 30;

const TYPE_LABELS = {
  channel: 'Канал',
  supergroup: 'Супергрупа',
  group: 'Група',
};

const TYPE_FILTERS = [
  { id: '', label: 'Усі' },
  { id: 'channel', label: 'Канали' },
  { id: 'groups', label: 'Групи' },
];

const MEDIA_LABELS = {
  photo: 'фото',
  video: 'відео',
  video_note: 'відеоповідомлення',
  gif: 'GIF',
  voice: 'голосове',
  audio: 'аудіо',
  sticker: 'стікер',
  poll: 'опитування',
  link: 'посилання',
  location: 'геолокація',
  contact: 'контакт',
  document: 'файл',
  other: 'медіа',
};

function matchesType(chat, filter) {
  if (!filter) return true;
  return filter === 'channel' ? chat.type === 'channel' : chat.type !== 'channel';
}

function mediaLabel(item) {
  if (!item.mediaType) return null;
  const label = MEDIA_LABELS[item.mediaType] || 'медіа';
  return item.mediaCount > 1 ? `альбом: ${item.mediaCount} ${label}` : label;
}

function MessageText({ item }) {
  const media = mediaLabel(item);
  return (
    <>
      {media && (
        <span className="muted" style={{ fontSize: 12 }}>
          [{media}]{' '}
        </span>
      )}
      {item.text || (!media && <span className="muted">-</span>)}
    </>
  );
}

// Keeps a newest-first list that grows backwards page by page. `fetchPage(offsetId)`
// must resolve to { items, nextOffsetId }. Responses from a superseded load (the
// chat or post changed meanwhile) are dropped.
function usePagedList(fetchPage, deps) {
  const [items, setItems] = useState(null);
  const [nextOffsetId, setNextOffsetId] = useState(null);
  const [extra, setExtra] = useState({});
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(null);
  const generation = useRef(0);

  const load = async (offsetId = 0) => {
    const gen = offsetId ? generation.current : ++generation.current;
    if (!offsetId) {
      setItems(null);
      setNextOffsetId(null);
    }
    setError(null);
    setLoadingMore(Boolean(offsetId));
    try {
      const { items: page, nextOffsetId: next, ...rest } = await fetchPage(offsetId);
      if (gen !== generation.current) return;
      setItems((prev) => {
        if (!offsetId || !prev) return page;
        const seen = new Set(prev.map((i) => i.id));
        return [...prev, ...page.filter((i) => !seen.has(i.id))];
      });
      setNextOffsetId(next);
      if (!offsetId) setExtra(rest);
    } catch (err) {
      if (gen !== generation.current) return;
      setError(err);
      setItems((prev) => (offsetId && prev ? prev : []));
    } finally {
      if (gen === generation.current) setLoadingMore(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return {
    items,
    setItems,
    extra,
    error,
    loadingMore,
    hasMore: Boolean(nextOffsetId),
    reload: () => load(),
    loadMore: () => nextOffsetId && load(nextOffsetId),
  };
}

function PostThread({ accountId, chatId, post, onSent }) {
  const isComments = post.threadKind === 'comments';
  const thread = usePagedList(
    (offsetId) => fetchTelegramComments(accountId, chatId, post.id, { limit: COMMENTS_PAGE, offsetId }),
    [accountId, chatId, post.id]
  );
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState(null);

  const handleSend = async () => {
    if (!text.trim()) return;
    setSending(true);
    setSendError(null);
    try {
      await sendTelegramComment(accountId, chatId, post.id, text);
      setText('');
      await thread.reload();
      onSent?.();
    } catch (err) {
      setSendError(errorMessage(err, 'Не вдалося надіслати'));
    } finally {
      setSending(false);
    }
  };

  const byId = new Map((thread.items || []).map((c) => [c.id, c]));
  const total = thread.extra.total;
  const title = isComments ? 'Коментарі' : 'Відповіді в гілці';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ whiteSpace: 'pre-wrap' }}>
        <MessageText item={post} />
      </div>

      <div>
        <div className="card-title" style={{ marginBottom: 8 }}>
          {title}
          {total != null && <span className="muted"> ({total})</span>}
        </div>
        {thread.error && (
          <p className="error">{errorMessage(thread.error, `Не вдалося завантажити: ${title.toLowerCase()}`)}</p>
        )}
        {thread.items === null ? (
          <p className="muted">Завантаження...</p>
        ) : thread.items.length === 0 ? (
          !thread.error && <p className="muted">{isComments ? 'Коментарів ще немає' : 'Відповідей ще немає'}</p>
        ) : (
          <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {thread.items.map((c) => {
              const parent = c.replyToId ? byId.get(c.replyToId) : null;
              return (
                <li key={c.id}>
                  <strong>{c.own ? 'Ви' : c.author || 'Анонім'}</strong>
                  {c.authorUsername && (
                    <span className="muted" style={{ fontSize: 12 }}>
                      {' '}
                      @{c.authorUsername}
                    </span>
                  )}{' '}
                  <span className="muted" style={{ fontSize: 12 }}>
                    {formatDate(c.date)}
                    {c.reactions > 0 && ` · реакцій: ${c.reactions}`}
                  </span>
                  {c.replyToId && (
                    <div className="muted" style={{ fontSize: 12 }}>
                      у відповідь {parent ? `${parent.own ? 'вам' : parent.author || 'анонімові'}` : `на #${c.replyToId}`}
                    </div>
                  )}
                  <div style={{ whiteSpace: 'pre-wrap' }}>
                    <MessageText item={c} />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {thread.hasMore && (
          <button className="btn btn-sm" style={{ marginTop: 8 }} onClick={thread.loadMore} disabled={thread.loadingMore}>
            {thread.loadingMore ? 'Завантаження...' : 'Завантажити старіші'}
          </button>
        )}
      </div>

      <label className="field">
        <span className="field-label">{isComments ? 'Новий коментар' : 'Відповісти в гілці'}</span>
        <textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} />
      </label>
      {sendError && <span className="error-inline">{sendError}</span>}
      <div className="form-actions">
        <button className="btn btn-primary btn-sm" onClick={handleSend} disabled={sending || !text.trim()}>
          {sending ? 'Надсилання...' : 'Надіслати'}
        </button>
      </div>
    </div>
  );
}

function ChatNote({ chat, info }) {
  if (chat.type === 'channel') {
    const linked = info?.linkedChat;
    return (
      <>
        Чат обговорень:{' '}
        {!info
          ? '...'
          : linked
            ? `${linked.title}${linked.username ? ` (@${linked.username})` : ''}`
            : 'немає, коментарі в цьому каналі вимкнено'}
      </>
    );
  }
  if (chat.type === 'supergroup') {
    return (
      <>
        Повідомлення групи. Відповіді на кожне повідомлення відкриваються як гілка.
        {chat.forum && ' Група поділена на теми.'}
      </>
    );
  }
  return <>Звичайна група: Telegram не підтримує в ній гілок відповідей, доступні лише повідомлення.</>;
}

function ChatPosts({ accountId, chat }) {
  const [info, setInfo] = useState(null);
  const [expandedId, setExpandedId] = useState(null);
  const posts = usePagedList(
    (offsetId) => fetchTelegramPosts(accountId, chat.id, { limit: POSTS_PAGE, offsetId }),
    [accountId, chat.id]
  );
  const isChannel = chat.type === 'channel';

  useEffect(() => {
    let cancelled = false;
    setInfo(null);
    setExpandedId(null);
    fetchTelegramChat(accountId, chat.id)
      .then((data) => !cancelled && setInfo(data))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [accountId, chat.id]);

  const bumpCount = (postId) =>
    posts.setItems((items) =>
      items?.map((p) => (p.id === postId ? { ...p, commentsCount: p.commentsCount + 1 } : p))
    );

  const columns = 6;

  return (
    <div className="card">
      <div className="card-title" style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ flex: 1 }}>
          {isChannel ? 'Пости' : 'Повідомлення'}: {chat.title}
        </span>
        <button className="btn btn-sm" onClick={posts.reload} disabled={posts.items === null}>
          Оновити
        </button>
      </div>
      <p className="muted" style={{ marginBottom: 12, fontSize: 12.5 }}>
        <ChatNote chat={chat} info={info} />
      </p>
      {posts.error && <p className="error">{errorMessage(posts.error, 'Не вдалося завантажити пости')}</p>}
      {posts.items === null ? (
        <p className="muted">Завантаження...</p>
      ) : posts.items.length === 0 ? (
        !posts.error && <p className="empty-state">Постів не знайдено</p>
      ) : (
        <div className="table-wrap">
          <table className="vpn-table">
            <thead>
              <tr>
                <th>Дата</th>
                <th>Автор</th>
                <th>Текст</th>
                <th>{isChannel ? 'Перегляди / реакції' : 'Реакції'}</th>
                <th>{isChannel ? 'Коментарі' : 'Відповіді'}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {posts.items.map((post) => (
                <Fragment key={post.id}>
                  <tr>
                    <td data-label="Дата">
                      {formatDate(post.date)}
                      {post.pinned && <div className="muted" style={{ fontSize: 12 }}>закріплено</div>}
                    </td>
                    <td data-label="Автор">
                      {post.author || <span className="muted">-</span>}
                      {post.authorUsername && (
                        <div className="muted" style={{ fontSize: 12 }}>
                          @{post.authorUsername}
                        </div>
                      )}
                    </td>
                    <td data-label="Текст" className="post-text-cell" title={post.text}>
                      {post.forwarded && <span className="muted" style={{ fontSize: 12 }}>[переслано] </span>}
                      <MessageText item={post} />
                    </td>
                    <td data-label={isChannel ? 'Перегляди / реакції' : 'Реакції'}>
                      {isChannel ? `${post.views ?? '-'} / ${post.reactions}` : post.reactions}
                    </td>
                    <td data-label={isChannel ? 'Коментарі' : 'Відповіді'}>
                      {post.threadKind ? post.commentsCount : <span className="muted">недоступно</span>}
                    </td>
                    <td className="vpn-actions">
                      {post.url && (
                        <a href={post.url} target="_blank" rel="noreferrer">
                          відкрити
                        </a>
                      )}
                      {post.threadKind && (
                        <button
                          className={`btn btn-sm${expandedId === post.id ? ' btn-primary' : ''}`}
                          onClick={() => setExpandedId(expandedId === post.id ? null : post.id)}
                        >
                          {post.threadKind === 'comments' ? 'Коментарі' : 'Відповіді'}
                        </button>
                      )}
                    </td>
                  </tr>
                  {expandedId === post.id && (
                    <tr className="vpn-row-expanded">
                      <td colSpan={columns}>
                        <PostThread
                          accountId={accountId}
                          chatId={chat.id}
                          post={post}
                          onSent={() => bumpCount(post.id)}
                        />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {posts.hasMore && (
        <button className="btn btn-sm" style={{ marginTop: 12 }} onClick={posts.loadMore} disabled={posts.loadingMore}>
          {posts.loadingMore ? 'Завантаження...' : 'Завантажити старіші'}
        </button>
      )}
    </div>
  );
}

export default function TelegramChatsPanel({ account, onAutoComment }) {
  const [chats, setChats] = useState(null);
  const [typeFilter, setTypeFilter] = useState('');
  const [search, setSearch] = useState('');
  const [selectedChat, setSelectedChat] = useState(null);
  const [error, setError] = useState(null);

  const load = async () => {
    setChats(null);
    setError(null);
    try {
      setChats(await fetchTelegramChats(account._id));
    } catch (err) {
      setError(errorMessage(err, 'Не вдалося завантажити чати'));
      setChats([]);
    }
  };

  useEffect(() => {
    setSelectedChat(null);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account._id]);

  const query = search.trim().toLowerCase();
  const visible = (chats || []).filter(
    (chat) =>
      matchesType(chat, typeFilter) &&
      (!query || chat.title.toLowerCase().includes(query) || chat.username.toLowerCase().includes(query))
  );

  return (
    <div>
      <div className="card">
        <div className="card-title">
          Групи та канали: {account.displayName || account.phone}
          {chats?.length > 0 && <span className="muted"> ({chats.length})</span>}
        </div>
        <div className="account-checkboxes" style={{ marginBottom: 12 }}>
          {TYPE_FILTERS.map((f) => (
            <button
              key={f.id}
              className={`btn btn-sm${typeFilter === f.id ? ' btn-primary' : ''}`}
              onClick={() => setTypeFilter(f.id)}
            >
              {f.label}
            </button>
          ))}
          <input
            placeholder="Пошук за назвою або @username"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ flex: '1 1 200px' }}
          />
          <button className="btn btn-sm" onClick={load} disabled={chats === null}>
            {chats === null ? 'Завантаження...' : 'Оновити список'}
          </button>
        </div>
        {error && <p className="error">{error}</p>}
        {chats === null ? (
          <p className="muted">Завантаження...</p>
        ) : visible.length === 0 ? (
          <p className="empty-state">Чатів не знайдено</p>
        ) : (
          <div className="table-wrap">
            <table className="vpn-table">
              <thead>
                <tr>
                  <th>Назва</th>
                  <th>Тип</th>
                  <th>Username</th>
                  <th>Учасників</th>
                  <th>Чат обговорень</th>
                  <th>Остання активність</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {visible.map((chat) => (
                  <tr key={chat.id}>
                    <td data-label="Назва">
                      {chat.title}
                      {chat.archived && <span className="muted" style={{ fontSize: 12 }}> · архів</span>}
                    </td>
                    <td data-label="Тип">
                      {TYPE_LABELS[chat.type] || chat.type}
                      {chat.forum && <span className="muted" style={{ fontSize: 12 }}> · теми</span>}
                    </td>
                    <td data-label="Username">{chat.username ? `@${chat.username}` : '-'}</td>
                    <td data-label="Учасників">{chat.membersCount ?? '-'}</td>
                    <td data-label="Чат обговорень">
                      {chat.type === 'channel' ? (
                        chat.hasLinkedChat ? (
                          <span className="status-badge auth-authorized">є</span>
                        ) : (
                          <span className="muted">немає</span>
                        )
                      ) : chat.hasLinkedChat ? (
                        <span className="status-badge auth-unknown">прив'язана до каналу</span>
                      ) : (
                        <span className="muted">-</span>
                      )}
                    </td>
                    <td data-label="Остання активність">
                      {chat.lastMessageDate ? formatDate(chat.lastMessageDate) : '-'}
                      {chat.unreadCount > 0 && (
                        <div className="muted" style={{ fontSize: 12 }}>
                          непрочитаних: {chat.unreadCount}
                        </div>
                      )}
                    </td>
                    <td className="vpn-actions">
                      <button
                        className={`btn btn-sm${selectedChat?.id === chat.id ? ' btn-primary' : ''}`}
                        onClick={() => setSelectedChat(selectedChat?.id === chat.id ? null : chat)}
                      >
                        {chat.type === 'channel' ? 'Пости' : 'Повідомлення'}
                      </button>
                      {onAutoComment &&
                        ((chat.type === 'channel' && chat.hasLinkedChat) || chat.type === 'supergroup') && (
                          <button className="btn btn-sm" onClick={() => onAutoComment(chat)}>
                            Автокоментар
                          </button>
                        )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {selectedChat && <ChatPosts accountId={account._id} chat={selectedChat} />}
    </div>
  );
}
