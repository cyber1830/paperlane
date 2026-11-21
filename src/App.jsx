import { useCallback, useEffect, useRef, useState } from 'react';

let uid = localStorage.getItem('uid');

async function api(path, opts = {}) {
  const res = await fetch('/api' + path, {
    ...opts,
    headers: {
      'x-user-id': uid,
      ...(opts.body && !(opts.body instanceof FormData)
        ? { 'content-type': 'application/json' }
        : {}),
      ...opts.headers,
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || 'Request failed');
  }
  return data;
}

function timeAgo(iso) {
  const seconds = (Date.now() - new Date(iso)) / 1000;
  if (seconds < 60) return 'Just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} hr ago`;
  return new Date(iso).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function htmlToMarkdown(html) {
  const root = new DOMParser().parseFromString(html, 'text/html').body;
  const inline = (node) =>
    Array.from(node.childNodes)
      .map((child) => {
        if (child.nodeType === 3) return child.textContent;
        const tag = child.tagName.toLowerCase();
        const inner = inline(child);
        if (tag === 'b' || tag === 'strong') return `**${inner}**`;
        if (tag === 'i' || tag === 'em') return `*${inner}*`;
        if (tag === 'u') return `<u>${inner}</u>`;
        if (tag === 'br') return '\n';
        return inner;
      })
      .join('');
  const blocks = Array.from(root.childNodes).map((node) => {
    if (node.nodeType === 3) return node.textContent.trim();
    const tag = node.tagName.toLowerCase();
    if (/^h[1-3]$/.test(tag)) return `${'#'.repeat(Number(tag[1]))} ${inline(node)}`;
    if (tag === 'ul') {
      return Array.from(node.children).map((li) => `- ${inline(li)}`).join('\n');
    }
    if (tag === 'ol') {
      return Array.from(node.children)
        .map((li, index) => `${index + 1}. ${inline(li)}`)
        .join('\n');
    }
    return inline(node);
  });
  return blocks.filter(Boolean).join('\n\n') + '\n';
}

function downloadMarkdown(title, html) {
  const blob = new Blob([htmlToMarkdown(html)], { type: 'text/markdown' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `${title.trim() || 'document'}.md`;
  link.click();
  URL.revokeObjectURL(link.href);
}

function Avatar({ name }) {
  return (
    <span className="avatar" aria-hidden>
      {name[0]}
    </span>
  );
}

function Logo() {
  return (
    <span className="logo">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
        <rect x="4" y="2" width="16" height="20" rx="3" fill="currentColor" />
        <path
          d="M8 8h8M8 12h8M8 16h5"
          stroke="var(--paper)"
          strokeWidth="1.8"
          strokeLinecap="round"
        />
      </svg>
      Paperlane
    </span>
  );
}

function Toasts({ items }) {
  return (
    <div className="toasts" role="status">
      {items.map((toast) => (
        <div key={toast.id} className={'toast ' + toast.kind}>
          {toast.text}
        </div>
      ))}
    </div>
  );
}

function useToasts() {
  const [items, setItems] = useState([]);

  const push = useCallback((text, kind = 'ok') => {
    const id = Math.random();
    setItems((current) => [...current, { id, text, kind }]);
    setTimeout(() => {
      setItems((current) => current.filter((item) => item.id !== id));
    }, 3500);
  }, []);

  return [items, push];
}

function Login({ onLogin }) {
  const [users, setUsers] = useState([]);

  useEffect(() => {
    fetch('/api/users')
      .then((res) => res.json())
      .then(setUsers);
  }, []);

  return (
    <main className="login">
      <Logo />
      <h1>Write together, keep it simple</h1>
      <p className="muted">
        Pick a demo account to try sharing between people.
      </p>
      <div className="accounts">
        {users.map((user) => (
          <button
            key={user.id}
            className="account"
            onClick={() => {
              uid = String(user.id);
              localStorage.setItem('uid', uid);
              onLogin(user);
            }}
          >
            <Avatar name={user.name} />
            <span>
              <b>{user.name}</b>
              <small>{user.email}</small>
            </span>
          </button>
        ))}
      </div>
    </main>
  );
}

function ToolButton({ command, value, active, label, children, onRun }) {
  return (
    <button
      type="button"
      className={'tool' + (active ? ' on' : '')}
      aria-label={label}
      aria-pressed={!!active}
      title={label}
      onMouseDown={(event) => {
        event.preventDefault();
        document.execCommand(command, false, value);
        onRun();
      }}
    >
      {children}
    </button>
  );
}

function ListIcon({ numbered }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
    >
      {[7, 12, 17].map((y, index) => (
        <g key={y}>
          <path d={`M10 ${y}h10`} />
          {numbered ? (
            <text
              x="2"
              y={y + 3}
              fontSize="8"
              fill="currentColor"
              stroke="none"
            >
              {index + 1}
            </text>
          ) : (
            <circle cx="5" cy={y} r="1.3" fill="currentColor" />
          )}
        </g>
      ))}
    </svg>
  );
}

function ShareDialog({ doc, onChanged, onClose, toast }) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('editor');
  const [err, setErr] = useState('');

  const grant = async (targetEmail, targetRole) => {
    const user = await api(`/docs/${doc.id}/share`, {
      method: 'POST',
      body: JSON.stringify({ email: targetEmail, role: targetRole }),
    });
    onChanged((list) =>
      list.some((item) => item.id === user.id)
        ? list.map((item) => (item.id === user.id ? user : item))
        : [...list, user],
    );
    return user;
  };

  const submit = async (event) => {
    event.preventDefault();
    try {
      const user = await grant(email, role);
      setEmail('');
      setErr('');
      toast(`Shared with ${user.name}`);
    } catch (error) {
      setErr(error.message);
    }
  };

  const change = async (user, nextRole) => {
    try {
      await grant(user.email, nextRole);
      setErr('');
      toast(`${user.name}: ${nextRole === 'viewer' ? 'view only' : 'can edit'}`);
    } catch (error) {
      setErr(error.message);
    }
  };

  const remove = async (user) => {
    try {
      await api(`/docs/${doc.id}/share/${user.id}`, { method: 'DELETE' });
      onChanged((list) => list.filter((item) => item.id !== user.id));
      toast(`Removed ${user.name}`);
    } catch (error) {
      setErr(error.message);
    }
  };

  const roleOptions = (
    <>
      <option value="editor">Can edit</option>
      <option value="viewer">View only</option>
    </>
  );

  return (
    <div className="scrim" onClick={onClose}>
      <div
        className="dialog"
        role="dialog"
        aria-label="Share document"
        onClick={(event) => event.stopPropagation()}
      >
        <h2>Share “{doc.title}”</h2>
        <form onSubmit={submit}>
          <input
            autoFocus
            type="email"
            required
            placeholder="Add person by email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
          <select
            aria-label="Permission"
            value={role}
            onChange={(event) => setRole(event.target.value)}
          >
            {roleOptions}
          </select>
          <button className="primary">Share</button>
        </form>
        {err && <p className="inline-err">{err}</p>}

        <h3>People with access</h3>
        <ul className="people">
          <li>
            <Avatar name={doc.owner_name} />
            <span>
              {doc.owner_name}
              <small>Owner</small>
            </span>
          </li>
          {doc.shared_with.map((user) => (
            <li key={user.id}>
              <Avatar name={user.name} />
              <span>
                {user.name}
                <small>{user.email}</small>
              </span>
              <select
                aria-label={`Permission for ${user.name}`}
                value={user.role}
                onChange={(event) => change(user, event.target.value)}
              >
                {roleOptions}
              </select>
              <button
                className="ghost"
                aria-label={`Remove ${user.name}`}
                onClick={() => remove(user)}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>

        <div className="dialog-foot">
          <button onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}

function HistoryPanel({ docId, canEdit, onRestore, onClose, toast }) {
  const [versions, setVersions] = useState(null);
  const [picked, setPicked] = useState(null);

  useEffect(() => {
    api(`/docs/${docId}/versions`)
      .then(setVersions)
      .catch((error) => toast(error.message, 'err'));
  }, [docId]);

  const pick = async (version) => {
    try {
      setPicked(await api(`/docs/${docId}/versions/${version.id}`));
    } catch (error) {
      toast(error.message, 'err');
    }
  };

  const restore = async () => {
    try {
      const restored = await api(
        `/docs/${docId}/versions/${picked.id}/restore`,
        { method: 'POST' },
      );
      onRestore(restored);
      toast('Version restored');
      onClose();
    } catch (error) {
      toast(error.message, 'err');
    }
  };

  return (
    <aside className="panel" aria-label="Version history">
      <div className="panel-head">
        <h2>Version history</h2>
        <button className="ghost" onClick={onClose}>
          Close
        </button>
      </div>
      {versions === null ? (
        <p className="muted">Loading…</p>
      ) : versions.length === 0 ? (
        <p className="muted">
          No earlier versions yet. They appear as you keep editing.
        </p>
      ) : (
        <ul className="versions">
          {versions.map((version) => (
            <li key={version.id}>
              <button
                className={picked?.id === version.id ? 'on' : ''}
                onClick={() => pick(version)}
              >
                {new Date(version.saved_at).toLocaleString()}
              </button>
            </li>
          ))}
        </ul>
      )}
      {picked && (
        <>
          <div
            className="preview"
            dangerouslySetInnerHTML={{ __html: picked.content }}
          />
          {canEdit ? (
            <button className="primary" onClick={restore}>
              Restore this version
            </button>
          ) : (
            <p className="muted">View-only access can’t restore versions.</p>
          )}
        </>
      )}
    </aside>
  );
}

function Editor({ id, onBack, toast }) {
  const [doc, setDoc] = useState(null);
  const [title, setTitle] = useState('');
  const [status, setStatus] = useState('saved');
  const [fmt, setFmt] = useState({});
  const [sharing, setSharing] = useState(false);
  const [err, setErr] = useState('');
  const ed = useRef();
  const timer = useRef();
  const titleRef = useRef('');
  const canEdit = !doc || doc.role !== 'viewer';
  const [historyOpen, setHistoryOpen] = useState(false);
  const [others, setOthers] = useState([]);

  // Presence heartbeat: shows who else has this document open right now.
  useEffect(() => {
    const ping = () =>
      api(`/docs/${id}/presence`, { method: 'POST' })
        .then(setOthers)
        .catch(() => {});
    ping();
    const interval = setInterval(ping, 5000);
    return () => clearInterval(interval);
  }, [id]);

  useEffect(() => {
    api(`/docs/${id}`)
      .then((loaded) => {
        setDoc(loaded);
        setTitle(loaded.title);
        titleRef.current = loaded.title;
      })
      .catch((error) => setErr(error.message));
  }, [id]);

  useEffect(() => {
    if (doc && ed.current) {
      ed.current.innerHTML = doc.content;
    }
  }, [doc?.id]);

  // Highlight toolbar buttons that match the formatting at the cursor.
  useEffect(() => {
    const onSelection = () => {
      if (!ed.current?.contains(document.getSelection()?.anchorNode)) {
        return;
      }
      setFmt({
        bold: document.queryCommandState('bold'),
        italic: document.queryCommandState('italic'),
        underline: document.queryCommandState('underline'),
        ul: document.queryCommandState('insertUnorderedList'),
        ol: document.queryCommandState('insertOrderedList'),
        block: String(document.queryCommandValue('formatBlock')).toLowerCase(),
      });
    };
    document.addEventListener('selectionchange', onSelection);
    return () => document.removeEventListener('selectionchange', onSelection);
  }, []);

  const save = useCallback(async () => {
    if (!ed.current || !titleRef.current.trim()) {
      return;
    }

    setStatus('saving');
    try {
      await api(`/docs/${id}`, {
        method: 'PUT',
        body: JSON.stringify({
          title: titleRef.current,
          content: ed.current.innerHTML,
        }),
      });
      setStatus('saved');
      setErr('');
    } catch (error) {
      setStatus('error');
      setErr(error.message);
    }
  }, [id]);

  const queue = () => {
    setStatus('editing');
    clearTimeout(timer.current);
    timer.current = setTimeout(save, 700);
  };

  if (!doc) {
    return <div className="center">{err || 'Opening document…'}</div>;
  }

  const statusLabel = {
    saved: 'All changes saved',
    saving: 'Saving…',
    editing: 'Unsaved changes',
    error: 'Could not save',
  }[status];

  return (
    <div className="editor-view">
      <header className="topbar">
        <button
          className="ghost"
          aria-label="Back to documents"
          onClick={async () => {
            clearTimeout(timer.current);
            if (canEdit) await save();
            onBack();
          }}
        >
          ‹ Documents
        </button>
        <input
          className="title"
          value={title}
          placeholder="Untitled document"
          readOnly={!canEdit}
          onChange={(event) => {
            setTitle(event.target.value);
            titleRef.current = event.target.value;
            queue();
          }}
          aria-label="Document title"
        />
        <span className={'status ' + status}>{canEdit ? statusLabel : 'View only'}</span>
        <div className="presence" aria-label="People here now">
          {others.map((person) => (
            <span key={person.id} title={`${person.name} is here`}>
              <Avatar name={person.name} />
            </span>
          ))}
        </div>
        <button className="ghost" onClick={() => setHistoryOpen(true)}>
          History
        </button>
        <details className="menu">
          <summary>Export</summary>
          <div>
            <button
              className="ghost"
              onClick={(event) => {
                event.currentTarget.closest('details').open = false;
                downloadMarkdown(titleRef.current, ed.current.innerHTML);
              }}
            >
              Markdown (.md)
            </button>
            <button
              className="ghost"
              onClick={(event) => {
                event.currentTarget.closest('details').open = false;
                window.print();
              }}
            >
              PDF (print)
            </button>
          </div>
        </details>
        {doc.role === 'owner' ? (
          <button className="primary" onClick={() => setSharing(true)}>
            Share{doc.shared_with.length ? ` · ${doc.shared_with.length}` : ''}
          </button>
        ) : (
          <span className="pill shared">
            Shared by {doc.owner_name} · {canEdit ? 'Can edit' : 'View only'}
          </span>
        )}
      </header>

      <div
        className={'toolbar' + (canEdit ? '' : ' disabled')}
        role="toolbar"
        aria-label="Formatting"
      >
        <ToolButton
          command="bold"
          active={fmt.bold}
          label="Bold (Ctrl+B)"
          onRun={queue}
        >
          <b>B</b>
        </ToolButton>
        <ToolButton
          command="italic"
          active={fmt.italic}
          label="Italic (Ctrl+I)"
          onRun={queue}
        >
          <i>I</i>
        </ToolButton>
        <ToolButton
          command="underline"
          active={fmt.underline}
          label="Underline (Ctrl+U)"
          onRun={queue}
        >
          <u>U</u>
        </ToolButton>
        <span className="sep" />
        <ToolButton
          command="formatBlock"
          value="h1"
          active={fmt.block === 'h1'}
          label="Heading 1"
          onRun={queue}
        >
          H1
        </ToolButton>
        <ToolButton
          command="formatBlock"
          value="h2"
          active={fmt.block === 'h2'}
          label="Heading 2"
          onRun={queue}
        >
          H2
        </ToolButton>
        <ToolButton
          command="formatBlock"
          value="p"
          active={fmt.block === 'p'}
          label="Normal text"
          onRun={queue}
        >
          Text
        </ToolButton>
        <span className="sep" />
        <ToolButton
          command="insertUnorderedList"
          active={fmt.ul}
          label="Bulleted list"
          onRun={queue}
        >
          <ListIcon />
        </ToolButton>
        <ToolButton
          command="insertOrderedList"
          active={fmt.ol}
          label="Numbered list"
          onRun={queue}
        >
          <ListIcon numbered />
        </ToolButton>
      </div>

      {err && <div className="banner">{err}</div>}

      <main className="desk">
        <div
          ref={ed}
          className="paper"
          contentEditable={canEdit}
          suppressContentEditableWarning
          spellCheck
          onInput={queue}
          aria-label="Document body"
          data-placeholder="Start writing…"
        />
      </main>

      {historyOpen && (
        <HistoryPanel
          docId={id}
          canEdit={canEdit}
          toast={toast}
          onClose={() => setHistoryOpen(false)}
          onRestore={(restored) => {
            ed.current.innerHTML = restored.content;
            setTitle(restored.title);
            titleRef.current = restored.title;
            setStatus('saved');
          }}
        />
      )}

      {sharing && (
        <ShareDialog
          doc={doc}
          toast={toast}
          onClose={() => setSharing(false)}
          onChanged={(update) =>
            setDoc((current) => ({
              ...current,
              shared_with: update(current.shared_with),
            }))
          }
        />
      )}
    </div>
  );
}

export default function App() {
  const [user, setUser] = useState(null);
  const [docs, setDocs] = useState(null);
  const [open, setOpen] = useState(null);
  const [tab, setTab] = useState('all');
  const [query, setQuery] = useState('');
  const [toasts, toast] = useToasts();

  const load = () =>
    api('/docs')
      .then(setDocs)
      .catch((error) => toast(error.message, 'err'));

  useEffect(() => {
    if (uid) {
      fetch('/api/users')
        .then((res) => res.json())
        .then((users) => {
          const currentUser = users.find((item) => String(item.id) === uid);
          if (currentUser) {
            setUser(currentUser);
          } else {
            localStorage.removeItem('uid');
          }
        });
    }
  }, []);

  useEffect(() => {
    if (user && !open) {
      load();
    }
  }, [user, open]);

  if (!user) {
    return <Login onLogin={setUser} />;
  }

  if (open) {
    return (
      <>
        <Editor id={open} onBack={() => setOpen(null)} toast={toast} />
        <Toasts items={toasts} />
      </>
    );
  }

  const create = async () => {
    const created = await api('/docs', {
      method: 'POST',
      body: JSON.stringify({ title: 'Untitled document' }),
    });
    setOpen(created.id);
  };

  const upload = async (event) => {
    const file = event.target.files[0];
    if (!file) {
      return;
    }

    const formData = new FormData();
    formData.append('file', file);
    try {
      const created = await api('/upload', {
        method: 'POST',
        body: formData,
      });
      toast(`Imported “${created.title}”`);
      setOpen(created.id);
    } catch (error) {
      toast(error.message, 'err');
    }
    event.target.value = '';
  };

  const countByRole = (role) =>
    (docs || []).filter((item) => item.role === role).length;

  const visible = (docs || []).filter((item) => {
    const roleMatches =
      tab === 'all' || item.role === (tab === 'mine' ? 'owner' : 'shared');
    return roleMatches && item.title.toLowerCase().includes(query.toLowerCase());
  });

  const tabs = [
    ['all', 'All', docs ? docs.length : 0],
    ['mine', 'Owned by me', countByRole('owner')],
    ['shared', 'Shared with me', countByRole('shared')],
  ];

  const emptyTitle = query
    ? 'No matches'
    : tab === 'shared'
      ? 'Nothing shared with you yet'
      : 'No documents yet';

  const emptyHint = query
    ? 'Try a different title.'
    : tab === 'shared'
      ? 'When someone shares a document with you, it shows up here.'
      : 'Select New document or import a .txt, .md or .docx file.';

  return (
    <div className="home">
      <header className="topbar">
        <Logo />
        <span className="grow" />
        <Avatar name={user.name} />
        <b>{user.name}</b>
        <button
          className="ghost"
          onClick={() => {
            localStorage.removeItem('uid');
            uid = null;
            setUser(null);
          }}
        >
          Switch user
        </button>
      </header>

      <main className="wrap">
        <div className="hero">
          <div>
            <h1>Documents</h1>
            <p className="muted">
              Create a draft or import a file to start editing.
            </p>
          </div>
          <div className="actions">
            <label
              className="btn"
              title="Supported: .txt, .md, .docx (max 2 MB)"
            >
              Import file
              <input
                type="file"
                accept=".txt,.md,.docx"
                hidden
                onChange={upload}
              />
            </label>
            <button className="primary" onClick={create}>
              New document
            </button>
          </div>
        </div>

        <div className="filters">
          <div className="tabs" role="tablist">
            {tabs.map(([key, label, count]) => (
              <button
                key={key}
                role="tab"
                aria-selected={tab === key}
                className={tab === key ? 'on' : ''}
                onClick={() => setTab(key)}
              >
                {label} <span>{count}</span>
              </button>
            ))}
          </div>
          <input
            className="search"
            type="search"
            placeholder="Search by title"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label="Search documents"
          />
        </div>

        {docs === null ? (
          <p className="muted">Loading…</p>
        ) : visible.length === 0 ? (
          <div className="empty">
            <h2>{emptyTitle}</h2>
            <p className="muted">{emptyHint}</p>
          </div>
        ) : (
          <ul className="docs">
            {visible.map((item) => (
              <li key={item.id}>
                <button className="doc" onClick={() => setOpen(item.id)}>
                  <svg
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                  >
                    <path d="M6 3h8l4 4v14H6z" />
                    <path d="M14 3v4h4M9 12h6M9 16h6" />
                  </svg>
                  <span className="doc-title">{item.title}</span>
                  <span className={'pill ' + item.role}>
                    {item.role === 'owner'
                      ? 'Owner'
                      : `Shared by ${item.owner_name} · ${
                          item.access === 'viewer' ? 'View only' : 'Can edit'
                        }`}
                  </span>
                  <span className="muted when">{timeAgo(item.updated_at)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </main>

      <Toasts items={toasts} />
    </div>
  );
}