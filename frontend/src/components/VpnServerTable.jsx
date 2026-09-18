import { Fragment, useState } from 'react';
import StatusBadge, { formatDate } from './StatusBadge';
import ServerSessions from './ServerSessions';

export default function VpnServerTable({ servers, onCheck, onDelete }) {
  const [expandedId, setExpandedId] = useState(null);
  const [checkingId, setCheckingId] = useState(null);

  const toggleExpand = (id) => setExpandedId((prev) => (prev === id ? null : id));

  const handleCheck = async (id) => {
    setCheckingId(id);
    await onCheck(id);
    setCheckingId(null);
  };

  if (!servers.length) return <p className="empty-state">Серверів ще немає</p>;

  return (
    <div className="table-wrap">
      <table className="vpn-table">
        <thead>
          <tr>
            <th>Назва</th>
            <th>Хост</th>
            <th>Протокол</th>
            <th>Країна</th>
            <th>Статус</th>
            <th>Остання перевірка</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {servers.map((server) => (
            <Fragment key={server._id}>
              <tr className="vpn-row">
                <td data-label="Назва">{server.name}</td>
                <td data-label="Хост">
                  {server.host}:{server.port}
                </td>
                <td data-label="Протокол">{server.protocol}</td>
                <td data-label="Країна">{server.location || '-'}</td>
                <td data-label="Статус">
                  <StatusBadge status={server.status} />
                </td>
                <td data-label="Остання перевірка">{formatDate(server.lastCheckedAt)}</td>
                <td className="vpn-actions">
                  <button
                    className="btn btn-sm"
                    onClick={() => handleCheck(server._id)}
                    disabled={checkingId === server._id}
                  >
                    {checkingId === server._id ? 'Перевірка...' : 'Перевірити'}
                  </button>
                  <button className="btn btn-sm" onClick={() => toggleExpand(server._id)}>
                    {expandedId === server._id ? 'Сховати сесії' : 'Сесії'}
                  </button>
                  <button className="btn btn-danger btn-sm" onClick={() => onDelete(server._id)}>
                    Видалити
                  </button>
                </td>
              </tr>
              {expandedId === server._id && (
                <tr className="vpn-row-expanded">
                  <td colSpan={7}>
                    <ServerSessions server={server} />
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}
