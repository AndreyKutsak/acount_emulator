import { useEffect, useState } from "react";
import { fetchItems, createItem, deleteItem } from "./api/items";
import { errorMessage } from "./api/client";
import ItemForm from "./components/ItemForm";
import ItemList from "./components/ItemList";
import VpnServersPage from "./pages/VpnServersPage";
import SocialAccountsPage from "./pages/SocialAccountsPage";
import PostsPage from "./pages/PostsPage";
import ThreadsCommentsPage from "./pages/ThreadsCommentsPage";
import ThreadsDmPage from "./pages/ThreadsDmPage";
import TelegramPage from "./pages/TelegramPage";
import DashboardPage from "./pages/DashboardPage";
import AndroidPage from "./pages/AndroidPage";
import HelpPage from "./pages/HelpPage";
import ProfilesPage from "./pages/ProfilesPage";

function ItemsPage() {
  const [items, setItems] = useState([]);
  const [error, setError] = useState(null);

  const loadItems = async () => {
    try {
      const data = await fetchItems();
      setItems(data);
    } catch (err) {
      setError("Не вдалося завантажити дані");
    }
  };

  useEffect(() => {
    loadItems();
  }, []);

  const handleCreate = async (data) => {
    setError(null);
    try {
      await createItem(data);
      loadItems();
    } catch (err) {
      setError(errorMessage(err, "Не вдалося додати елемент"));
    }
  };

  const handleDelete = async (id) => {
    setError(null);
    try {
      await deleteItem(id);
      loadItems();
    } catch (err) {
      setError(errorMessage(err, "Не вдалося видалити елемент"));
    }
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h2>Елементи</h2>
          <p className="page-subtitle">Службовий список для тестових записів</p>
        </div>
      </div>
      {error && <p className="error">{error}</p>}
      <div className="card">
        <ItemForm onCreate={handleCreate} />
      </div>
      <ItemList items={items} onDelete={handleDelete} />
    </div>
  );
}

// Розділи, згруповані за тим, що оператор робить: щоденна робота, пристрої,
// облікові записи, довідка. Порядок у групі - від найчастішого.
const TABS = [
  { id: "dashboard", group: "Робота", label: "Огляд", Component: DashboardPage },
  { id: "posts", group: "Робота", label: "Пости", Component: PostsPage },
  { id: "threads-dm", group: "Робота", label: "Автовідповіді", Component: ThreadsDmPage },
  { id: "threads-comments", group: "Робота", label: "Коментарі (веб)", Component: ThreadsCommentsPage },
  { id: "android", group: "Пристрої", label: "Телефони", Component: AndroidPage },
  { id: "profiles", group: "Пристрої", label: "Профілі", Component: ProfilesPage },
  { id: "accounts", group: "Облікові записи", label: "Акаунти", Component: SocialAccountsPage },
  { id: "telegram", group: "Облікові записи", label: "Telegram", Component: TelegramPage },
  { id: "vpn", group: "Облікові записи", label: "VPN сервери", Component: VpnServersPage },
  { id: "help", group: "Довідка", label: "Інструкція", Component: HelpPage },
  { id: "items", group: "Довідка", label: "Службові записи", Component: ItemsPage },
];
const GROUPS = [...new Set(TABS.map((t) => t.group))];

// Нижня панель на телефоні: розділи, куди заходять щодня; решта - у «Ще».
const BOTTOM_TABS = [
  { id: "dashboard", label: "Огляд", icon: "M4 13h6V4H4zM14 20h6v-9h-6zM4 20h6v-3H4zM14 7h6V4h-6z" },
  { id: "posts", label: "Пости", icon: "M5 4h14v16H5zM8 8h8M8 12h8M8 16h5" },
  { id: "threads-dm", label: "Відповіді", icon: "M4 5h16v11H9l-5 4zM8 9h8M8 12h5" },
  { id: "android", label: "Телефони", icon: "M7 3h10v18H7zM11 18h2" },
];
const MORE_ICON = "M4 7h16M4 12h16M4 17h16";

function readSavedTab() {
  try {
    const saved = localStorage.getItem("treds.tab");
    return TABS.some((t) => t.id === saved) ? saved : "dashboard";
  } catch {
    return "dashboard";
  }
}

export default function App() {
  const [tab, setTabState] = useState(readSavedTab);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const Active = TABS.find((t) => t.id === tab).Component;
  const setTab = (id) => {
    setTabState(id);
    window.scrollTo(0, 0);
    try {
      localStorage.setItem("treds.tab", id);
    } catch {
      // приватний режим - просто не запам'ятовуємо
    }
  };
  const inBottom = BOTTOM_TABS.some((t) => t.id === tab);

  useEffect(() => {
    if (!mobileMenuOpen) return undefined;

    const handleKeyDown = (event) => {
      if (event.key === "Escape") setMobileMenuOpen(false);
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [mobileMenuOpen]);

  return (
    <div className="app-shell">
      <header className="mobile-header">
        <div className="mobile-brand">
          <span className="brand-name">Treds</span>
          <span className="brand-tag">пульт керування</span>
        </div>
        <button
          type="button"
          className="mobile-menu-toggle"
          aria-label={mobileMenuOpen ? "Закрити меню" : "Відкрити меню"}
          aria-expanded={mobileMenuOpen}
          aria-controls="app-navigation"
          onClick={() => setMobileMenuOpen((open) => !open)}
        >
          {mobileMenuOpen ? (
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="m6 6 12 12M18 6 6 18" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 7h16M4 12h16M4 17h16" />
            </svg>
          )}
        </button>
      </header>
      {mobileMenuOpen && (
        <button
          type="button"
          className="sidebar-backdrop"
          aria-label="Закрити меню"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}
      <aside className={`sidebar${mobileMenuOpen ? " mobile-open" : ""}`}>
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">T</span>
          <div>
            <div className="brand-name">Treds</div>
            <div className="brand-tag">пульт керування</div>
          </div>
        </div>
        <nav className="nav" id="app-navigation" aria-label="Основна навігація">
          {GROUPS.map((g) => (
            <div key={g} className="nav-group">
              <div className="sidebar-section-label">{g}</div>
              {TABS.filter((t) => t.group === g).map((t) => (
                <button
                  key={t.id}
                  className={`nav-item${tab === t.id ? " active" : ""}`}
                  aria-current={tab === t.id ? "page" : undefined}
                  onClick={() => {
                    setTab(t.id);
                    setMobileMenuOpen(false);
                  }}
                >
                  {t.label}
                </button>
              ))}
            </div>
          ))}
        </nav>
      </aside>
      <main className="main">
        <Active />
      </main>
      <nav className="bottom-nav" aria-label="Швидкі розділи">
        {BOTTOM_TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`bottom-nav-item${tab === t.id ? " active" : ""}`}
            aria-current={tab === t.id ? "page" : undefined}
            onClick={() => {
              setTab(t.id);
              setMobileMenuOpen(false);
            }}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d={t.icon} />
            </svg>
            <span>{t.label}</span>
          </button>
        ))}
        <button
          type="button"
          className={`bottom-nav-item${!inBottom || mobileMenuOpen ? " active" : ""}`}
          aria-expanded={mobileMenuOpen}
          aria-controls="app-navigation"
          onClick={() => setMobileMenuOpen((open) => !open)}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d={MORE_ICON} />
          </svg>
          <span>{inBottom ? "Ще" : TABS.find((t) => t.id === tab).label}</span>
        </button>
      </nav>
    </div>
  );
}
