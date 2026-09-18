import { useEffect, useState } from "react";
import { fetchItems, createItem, deleteItem } from "./api/items";
import { errorMessage } from "./api/client";
import ItemForm from "./components/ItemForm";
import ItemList from "./components/ItemList";
import VpnServersPage from "./pages/VpnServersPage";
import SocialAccountsPage from "./pages/SocialAccountsPage";
import PostsPage from "./pages/PostsPage";
import ThreadsCommentsPage from "./pages/ThreadsCommentsPage";
import DashboardPage from "./pages/DashboardPage";

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
          <h2>Items</h2>
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

const TABS = [
  { id: "dashboard", label: "Огляд", Component: DashboardPage },
  { id: "posts", label: "Пости", Component: PostsPage },
  {
    id: "threads-comments",
    label: "Коментарі Threads",
    Component: ThreadsCommentsPage,
  },
  { id: "accounts", label: "Акаунти", Component: SocialAccountsPage },
  { id: "vpn", label: "VPN сервери", Component: VpnServersPage },
  { id: "items", label: "Items", Component: ItemsPage },
];

export default function App() {
  const [tab, setTab] = useState("dashboard");
  const Active = TABS.find((t) => t.id === tab).Component;

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-name">Treds</div>
          <div className="brand-tag">SMM агенція</div>
        </div>
        <nav className="nav">
          {TABS.map((t) => (
            <button
              key={t.id}
              className={`nav-item${tab === t.id ? " active" : ""}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </aside>
      <main className="main">
        <Active />
      </main>
    </div>
  );
}
