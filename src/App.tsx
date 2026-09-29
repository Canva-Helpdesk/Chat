import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { io, type Socket } from 'socket.io-client';
import {
  ArrowLeft,
  ArrowRight,
  Camera,
  Check,
  Crown,
  Copy,
  KeyRound,
  Link2,
  LogOut,
  Mail,
  MessageCircle,
  MessagesSquare,
  Plus,
  Settings2,
  Send,
  ShieldCheck,
  Trash2,
  UserRound,
  UsersRound,
  X,
} from 'lucide-react';

type User = { id: number; email: string; name: string; avatar: string | null };
type Conversation = {
  id: number;
  title: string;
  inviteToken: string;
  createdBy: number;
  myRole: 'owner' | 'admin' | 'member';
  lastMessage: string | null;
  lastMessageAt: string | null;
  memberCount?: number;
};
type Message = {
  id: number;
  conversationId: number;
  userId: number;
  userName: string;
  userAvatar: string | null;
  body: string;
  createdAt: string;
};
type Member = { id: number; name: string; avatar: string | null; role: 'owner' | 'admin' | 'member'; joinedAt: string };
type ApiError = { error: string };
type ApiOptions = { method?: string; body?: unknown };

async function api<T>(url: string, options: ApiOptions = {}): Promise<T> {
  const response = await fetch(url, {
    method: options.method ?? 'GET',
    credentials: 'same-origin',
    headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({})) as ApiError;
    throw new Error(error.error ?? 'Er ging iets mis. Probeer het opnieuw.');
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

function getInviteToken() {
  const url = new URL(window.location.href);
  const token = url.searchParams.get('invite');
  if (token) {
    sessionStorage.setItem('pending-invite', token);
    url.searchParams.delete('invite');
    window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
  }
  return sessionStorage.getItem('pending-invite');
}

function initials(name: string) {
  return name.split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? '').join('');
}

function Avatar({ name, src, className }: { name: string; src: string | null; className: string }) {
  return src
    ? <img className={`avatar-photo ${className}`} src={src} alt="" />
    : <span className={className}>{initials(name)}</span>;
}

function imageToAvatar(file: File) {
  return new Promise<string>((resolve, reject) => {
    if (!file.type.startsWith('image/')) return reject(new Error('Kies een afbeeldingsbestand.'));
    const image = new Image();
    const objectUrl = URL.createObjectURL(file);
    image.onload = () => {
      const scale = Math.min(1, 512 / Math.max(image.width, image.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(image.width * scale);
      canvas.height = Math.round(image.height * scale);
      const context = canvas.getContext('2d');
      if (!context) return reject(new Error('Deze afbeelding kon niet worden verwerkt.'));
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(objectUrl);
      resolve(canvas.toDataURL('image/jpeg', 0.8));
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Deze afbeelding kon niet worden gelezen.'));
    };
    image.src = objectUrl;
  });
}

function formatTime(value: string | null) {
  if (!value) return '';
  return new Intl.DateTimeFormat('nl-NL', { hour: '2-digit', minute: '2-digit' })
    .format(new Date(value));
}

function AuthScreen({ onAuthenticated }: { onAuthenticated: (user: User) => void }) {
  const [mode, setMode] = useState<'login' | 'register'>('register');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      const result = await api<{ user: User }>(`/api/${mode}`, {
        method: 'POST',
        body: mode === 'register' ? { name, email, password } : { email, password },
      });
      onAuthenticated(result.user);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Er ging iets mis.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-layout">
      <aside className="auth-aside">
        <a className="brand brand-light" href="/" aria-label="Chat startpagina">
          <span className="brand-mark"><MessageCircle size={19} strokeWidth={2.5} /></span>
          <span>chat</span>
        </a>
        <div className="aside-copy">
          <span className="eyebrow"><span className="status-dot" /> JOUW PLEK, JOUW MENSEN</span>
          <h1>Goed gesprek.<br /><em>Geen gedoe.</em></h1>
          <p>Een priveplek voor vrienden. Maak een gesprek en nodig iemand uit met een link.</p>
        </div>
        <div className="message-preview" aria-hidden="true">
          <span className="preview-avatar">J</span>
          <div><span className="preview-name">Jamie</span><p>Ben er over 5 min! ☀</p></div>
          <span className="preview-time">nu</span>
        </div>
        <span className="aside-foot">KLEINE GROEP. GOED GEZELSCHAP.</span>
      </aside>

      <section className="auth-panel">
        <div className="auth-mobile-brand brand">
          <span className="brand-mark"><MessageCircle size={19} strokeWidth={2.5} /></span>
          <span>chat</span>
        </div>
        <div className="auth-form-wrap">
          <div className="auth-heading">
            <span className="auth-icon"><MessagesSquare size={21} /></span>
            <h2>{mode === 'register' ? 'Maak je account' : 'Welkom terug'}</h2>
            <p>{mode === 'register' ? 'Een account en je bent klaar om te praten.' : 'Log in en pak het gesprek weer op.'}</p>
          </div>

          <form className="auth-form" onSubmit={submit}>
            {mode === 'register' && (
              <label className="field-label">Je naam
                <span className="input-wrap"><UsersRound size={17} /><input autoComplete="name" maxLength={28} minLength={2} onChange={(event) => setName(event.target.value)} placeholder="Hoe noemen je vrienden je?" required value={name} /></span>
              </label>
            )}
            <label className="field-label">E-mailadres
              <span className="input-wrap"><Mail size={17} /><input autoComplete="email" onChange={(event) => setEmail(event.target.value)} placeholder="jij@voorbeeld.nl" required type="email" value={email} /></span>
            </label>
            <label className="field-label">Wachtwoord
              <span className="input-wrap"><KeyRound size={17} /><input autoComplete={mode === 'register' ? 'new-password' : 'current-password'} minLength={8} onChange={(event) => setPassword(event.target.value)} placeholder="Minimaal 8 tekens" required type="password" value={password} /></span>
            </label>
            {error && <p className="form-error" role="alert">{error}</p>}
            <button className="primary-button auth-submit" disabled={busy} type="submit">
              {busy ? 'Even geduld...' : mode === 'register' ? 'Account aanmaken' : 'Inloggen'}
              {!busy && <ArrowRight size={17} />}
            </button>
          </form>

          <p className="auth-switch">
            {mode === 'register' ? 'Heb je al een account?' : 'Nog geen account?'}{' '}
            <button onClick={() => { setError(''); setMode(mode === 'register' ? 'login' : 'register'); }} type="button">
              {mode === 'register' ? 'Inloggen' : 'Account aanmaken'}
            </button>
          </p>
          <p className="auth-security"><ShieldCheck size={15} /> Je wachtwoord wordt versleuteld opgeslagen.</p>
        </div>
        <span className="auth-version">CHAT, GEWOON VOOR VRIENDEN</span>
      </section>
    </main>
  );
}

function GroupSettings({
  conversation,
  members,
  onClose,
  onMembersChanged,
  onConversationChanged,
  onLeave,
  onDelete,
}: {
  conversation: Conversation;
  members: Member[];
  onClose: () => void;
  onMembersChanged: () => Promise<void>;
  onConversationChanged: (conversation: Conversation) => void;
  onLeave: () => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const [title, setTitle] = useState(conversation.title);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const canManage = conversation.myRole === 'owner' || conversation.myRole === 'admin';

  async function saveTitle(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const result = await api<{ conversation: Conversation }>(`/api/conversations/${conversation.id}`, {
        method: 'PATCH',
        body: { title },
      });
      onConversationChanged(result.conversation);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Opslaan is niet gelukt.');
    } finally {
      setBusy(false);
    }
  }

  async function updateRole(member: Member) {
    setBusy(true);
    setError('');
    try {
      await api(`/api/conversations/${conversation.id}/members/${member.id}`, {
        method: 'PATCH',
        body: { role: member.role === 'admin' ? 'member' : 'admin' },
      });
      await onMembersChanged();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'De rol aanpassen is niet gelukt.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section aria-labelledby="group-settings-title" aria-modal="true" className="settings-modal" role="dialog">
        <button className="icon-button modal-close" aria-label="Instellingen sluiten" onClick={onClose} type="button"><X size={18} /></button>
        <span className="modal-icon"><Settings2 size={21} /></span>
        <span className="empty-eyebrow">GROEPSINSTELLINGEN</span>
        <h2 id="group-settings-title">{conversation.title}</h2>
        <form className="group-name-form" onSubmit={(event) => void saveTitle(event)}>
          <label className="field-label">Naam van de groep
            <input disabled={!canManage || busy} maxLength={48} minLength={2} onChange={(event) => setTitle(event.target.value)} value={title} />
          </label>
          {canManage && <button className="secondary-button" disabled={busy || title.trim() === conversation.title || title.trim().length < 2} type="submit">Naam opslaan</button>}
        </form>
        <div className="member-heading"><span>LEDEN</span><span>{members.length.toString().padStart(2, '0')}</span></div>
        <div className="settings-member-list">
          {members.map((member) => (
            <div className="settings-member" key={member.id}>
              <Avatar className="settings-member-avatar" name={member.name} src={member.avatar} />
              <span className="settings-member-name">{member.name}</span>
              {member.role === 'owner'
                ? <span className="role-pill role-owner"><Crown size={12} /> Eigenaar</span>
                : member.role === 'admin'
                  ? <button className="role-pill role-admin role-toggle" disabled={busy || conversation.myRole !== 'owner'} onClick={() => void updateRole(member)} title="Maak lid" type="button"><ShieldCheck size={12} /> Beheerder</button>
                  : conversation.myRole === 'owner'
                    ? <button className="role-action" disabled={busy} onClick={() => void updateRole(member)} title="Maak beheerder" type="button"><ShieldCheck size={15} /><span>Maak beheerder</span></button>
                    : <span className="role-pill role-member">Lid</span>}
            </div>
          ))}
        </div>
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="settings-footer">
          {conversation.myRole === 'owner' ? (
            <span className="owner-actions">
              <button className="danger-button" disabled={busy} onClick={() => void onLeave()} type="button"><ArrowLeft size={15} /> Groep verlaten</button>
              <button className="danger-button" disabled={busy} onClick={() => void onDelete()} type="button"><Trash2 size={15} /> Verwijderen</button>
            </span>
          ) : <button className="danger-button" disabled={busy} onClick={() => void onLeave()} type="button"><ArrowLeft size={15} /> Groep verlaten</button>}
          <button className="settings-done" onClick={onClose} type="button">Klaar</button>
        </div>
      </section>
    </div>
  );
}

function ProfileSettings({ user, onClose, onSaved }: { user: User; onClose: () => void; onSaved: (user: User) => void }) {
  const [name, setName] = useState(user.name);
  const [avatar, setAvatar] = useState<string | null>(user.avatar);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function choosePhoto(file?: File) {
    if (!file) return;
    setError('');
    try {
      setAvatar(await imageToAvatar(file));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'De foto kon niet worden geladen.');
    }
  }

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const result = await api<{ user: User }>('/api/profile', {
        method: 'PATCH',
        body: { name, avatar, ...(newPassword ? { currentPassword, newPassword } : {}) },
      });
      onSaved(result.user);
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Profiel opslaan is niet gelukt.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section aria-labelledby="profile-settings-title" aria-modal="true" className="settings-modal profile-modal" role="dialog">
        <button className="icon-button modal-close" aria-label="Instellingen sluiten" onClick={onClose} type="button"><X size={18} /></button>
        <span className="modal-icon"><UserRound size={21} /></span>
        <span className="empty-eyebrow">JOUW ACCOUNT</span>
        <h2 id="profile-settings-title">Profielinstellingen</h2>
        <form className="profile-settings-form" onSubmit={(event) => void saveProfile(event)}>
          <div className="photo-picker-row">
            <Avatar className="profile-preview-avatar" name={name || user.name} src={avatar} />
            <label className="photo-picker"><Camera size={15} /> Foto kiezen<input accept="image/png,image/jpeg,image/webp" onChange={(event) => void choosePhoto(event.target.files?.[0])} type="file" /></label>
            {avatar && <button className="remove-photo" onClick={() => setAvatar(null)} type="button">Verwijderen</button>}
          </div>
          <label className="field-label">Naam
            <input autoComplete="name" maxLength={28} minLength={2} onChange={(event) => setName(event.target.value)} required value={name} />
          </label>
          <label className="field-label">E-mailadres
            <input disabled value={user.email} />
          </label>
          <div className="password-divider"><span>Wachtwoord wijzigen</span></div>
          <label className="field-label">Huidig wachtwoord
            <input autoComplete="current-password" onChange={(event) => setCurrentPassword(event.target.value)} placeholder="Alleen nodig bij wijzigen" type="password" value={currentPassword} />
          </label>
          <label className="field-label">Nieuw wachtwoord
            <input autoComplete="new-password" minLength={8} onChange={(event) => setNewPassword(event.target.value)} placeholder="Minimaal 8 tekens" type="password" value={newPassword} />
          </label>
          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="primary-button modal-submit" disabled={busy} type="submit">{busy ? 'Bezig...' : 'Wijzigingen opslaan'}{!busy && <Check size={16} />}</button>
        </form>
      </section>
    </div>
  );
}

function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [onlineUserIds, setOnlineUserIds] = useState<number[]>([]);
  const [socket, setSocket] = useState<Socket | null>(null);
  const [draft, setDraft] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [mobileChatOpen, setMobileChatOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [members, setMembers] = useState<Member[]>([]);
  const [groupSettingsOpen, setGroupSettingsOpen] = useState(false);
  const [profileSettingsOpen, setProfileSettingsOpen] = useState(false);
  const listEndRef = useRef<HTMLDivElement>(null);
  const inviteTokenRef = useRef<string | null>(null);
  const activeConversation = conversations.find((conversation) => conversation.id === activeId) ?? null;

  useEffect(() => {
    inviteTokenRef.current = getInviteToken();
    api<{ user: User | null }>('/api/session')
      .then((result) => setUser(result.user))
      .catch(() => setError('De server is niet bereikbaar. Probeer de pagina te vernieuwen.'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!user) return;
    const connection = io();
    setSocket(connection);
    connection.on('message:new', (message: Message) => {
      setMessages((current) => current.some((item) => item.id === message.id) ? current : [...current, message]);
      setConversations((current) => current.map((conversation) => conversation.id === message.conversationId
        ? { ...conversation, lastMessage: message.body, lastMessageAt: message.createdAt }
        : conversation).sort((first, second) => (second.lastMessageAt ?? '').localeCompare(first.lastMessageAt ?? '')));
    });
    connection.on('presence:update', (update: { conversationId: number; onlineUserIds: number[] }) => {
      if (update.conversationId === activeId) setOnlineUserIds(update.onlineUserIds);
    });
    connection.on('conversation:updated', (update: { conversationId: number; title: string }) => {
      setConversations((current) => current.map((conversation) => conversation.id === update.conversationId
        ? { ...conversation, title: update.title }
        : conversation));
    });
    connection.on('members:updated', (update: { conversationId: number }) => {
      api<{ conversations: Conversation[] }>('/api/conversations').then((result) => setConversations(result.conversations));
      if (update.conversationId === activeId) {
        api<{ members: Member[] }>(`/api/conversations/${activeId}/members`).then((result) => setMembers(result.members));
      }
    });
    connection.on('conversation:deleted', (update: { conversationId: number }) => {
      setConversations((current) => current.filter((conversation) => conversation.id !== update.conversationId));
      setActiveId((current) => current === update.conversationId ? null : current);
      setMessages([]);
      setGroupSettingsOpen(false);
      setMobileChatOpen(false);
      setNotice('Dit gesprek is verwijderd door de eigenaar.');
    });
    connection.on('connect_error', () => setError('De liveverbinding is verbroken. Probeer opnieuw in te loggen.'));
    return () => { connection.disconnect(); setSocket(null); };
  }, [user, activeId]);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    async function loadChats() {
      setError('');
      try {
        const token = inviteTokenRef.current;
        let joinedId: number | null = null;
        if (token) {
          try {
            const result = await api<{ conversationId: number }>(`/api/invites/${encodeURIComponent(token)}`, { method: 'POST' });
            joinedId = result.conversationId;
            sessionStorage.removeItem('pending-invite');
            inviteTokenRef.current = null;
            setNotice('Je bent toegevoegd aan het gesprek.');
          } catch (reason) {
            sessionStorage.removeItem('pending-invite');
            inviteTokenRef.current = null;
            setError(reason instanceof Error ? reason.message : 'De uitnodigingslink is ongeldig.');
          }
        }
        const result = await api<{ conversations: Conversation[] }>('/api/conversations');
        if (cancelled) return;
        setConversations(result.conversations);
        const nextId = joinedId ?? (result.conversations.some((conversation) => conversation.id === activeId) ? activeId : result.conversations[0]?.id ?? null);
        setActiveId(nextId);
        setMobileChatOpen(Boolean(nextId));
      } catch (reason) {
        if (!cancelled) setError(reason instanceof Error ? reason.message : 'Chats laden is niet gelukt.');
      }
    }
    void loadChats();
    return () => { cancelled = true; };
  }, [user]);

  useEffect(() => {
    setMessages([]);
    setOnlineUserIds([]);
    if (!activeId || !user) return;
    socket?.emit('conversation:join', activeId);
    api<{ messages: Message[] }>(`/api/conversations/${activeId}/messages`)
      .then((result) => setMessages(result.messages))
      .catch((reason: Error) => setError(reason.message));
  }, [activeId, socket, user]);

  useEffect(() => {
    listEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(''), 3200);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  async function refreshConversations(preferredId?: number) {
    const result = await api<{ conversations: Conversation[] }>('/api/conversations');
    setConversations(result.conversations);
    if (preferredId) setActiveId(preferredId);
  }

  async function loadMembers(conversationId: number) {
    const result = await api<{ members: Member[] }>(`/api/conversations/${conversationId}/members`);
    setMembers(result.members);
  }

  async function openGroupSettings() {
    if (!activeConversation) return;
    setError('');
    setGroupSettingsOpen(true);
    try {
      await loadMembers(activeConversation.id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Groepsleden laden is niet gelukt.');
    }
  }

  async function leaveConversation() {
    if (!activeConversation) return;
    const confirmation = activeConversation.myRole === 'owner'
      ? `Verlaat ${activeConversation.title}? Het eigenaarschap wordt overgedragen aan een beheerder of het oudste lid.`
      : `Weet je zeker dat je ${activeConversation.title} wilt verlaten?`;
    if (!window.confirm(confirmation)) return;
    try {
      await api<void>(`/api/conversations/${activeConversation.id}/leave`, { method: 'POST' });
      setGroupSettingsOpen(false);
      setMessages([]);
      setMembers([]);
      await refreshConversations();
      const remaining = conversations.filter((conversation) => conversation.id !== activeConversation.id);
      setActiveId(remaining[0]?.id ?? null);
      setMobileChatOpen(Boolean(remaining.length));
      setNotice('Je hebt het gesprek verlaten.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Het gesprek verlaten is niet gelukt.');
    }
  }

  async function deleteConversation() {
    if (!activeConversation || !window.confirm(`Verwijder ${activeConversation.title} en alle berichten voor iedereen? Dit kan niet ongedaan worden gemaakt.`)) return;
    try {
      await api<void>(`/api/conversations/${activeConversation.id}`, { method: 'DELETE' });
      setConversations((current) => current.filter((conversation) => conversation.id !== activeConversation.id));
      setActiveId(null);
      setMessages([]);
      setMembers([]);
      setGroupSettingsOpen(false);
      setMobileChatOpen(false);
      setNotice('Het gesprek is verwijderd.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Het gesprek verwijderen is niet gelukt.');
    }
  }

  async function createConversation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const result = await api<{ conversation: Conversation }>('/api/conversations', {
        method: 'POST',
        body: { title: newTitle },
      });
      await refreshConversations(result.conversation.id);
      setNewTitle('');
      setCreateOpen(false);
      setMobileChatOpen(true);
      setNotice('Je privegesprek is klaar om te delen.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Gesprek maken is niet gelukt.');
    } finally {
      setBusy(false);
    }
  }

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = draft.trim();
    if (!body || !activeId || !socket) return;
    setDraft('');
    socket.emit('message:send', { conversationId: activeId, body }, (result: { error?: string }) => {
      if (result?.error) {
        setDraft(body);
        setError(result.error);
      }
    });
  }

  function handleMessageKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  }

  async function copyInviteLink() {
    if (!activeConversation) return;
    const link = new URL(window.location.href);
    link.search = '';
    link.hash = '';
    link.searchParams.set('invite', activeConversation.inviteToken);
    try {
      await navigator.clipboard.writeText(link.toString());
      setCopied(true);
      setNotice('Uitnodigingslink gekopieerd.');
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setError('Kopieren lukte niet. Controleer de browserrechten.');
    }
  }

  async function renewInviteLink() {
    if (!activeConversation) return;
    setBusy(true);
    try {
      const result = await api<{ inviteToken: string }>(`/api/conversations/${activeConversation.id}/invite`, { method: 'POST' });
      setConversations((current) => current.map((conversation) => conversation.id === activeConversation.id
        ? { ...conversation, inviteToken: result.inviteToken }
        : conversation));
      setNotice('Oude link ingetrokken. De nieuwe link is klaar.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'De link vernieuwen is niet gelukt.');
    } finally {
      setBusy(false);
    }
  }

  async function logOut() {
    try {
      await api<void>('/api/logout', { method: 'POST' });
      setUser(null);
      setConversations([]);
      setActiveId(null);
      setMessages([]);
      setSocket(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Uitloggen is niet gelukt.');
    }
  }

  if (loading) {
    return <main className="loading-screen"><span className="loading-mark"><MessageCircle size={23} /></span><span>Chat laadt...</span></main>;
  }

  if (!user) return <AuthScreen onAuthenticated={setUser} />;

  return (
    <main className="app-shell">
      <aside className={`sidebar${mobileChatOpen ? ' sidebar-hidden-mobile' : ''}`}>
        <div className="sidebar-top">
          <a className="brand" href="/" aria-label="Chat startpagina">
            <span className="brand-mark"><MessageCircle size={19} strokeWidth={2.5} /></span>
            <span>chat</span>
          </a>
          <button className="icon-button sidebar-add" aria-label="Nieuw gesprek" onClick={() => { setCreateOpen(true); setError(''); }} title="Nieuw gesprek" type="button"><Plus size={19} /></button>
        </div>

        <div className="sidebar-label-row"><span>JOUW GESPREKKEN</span><span className="chat-count">{conversations.length.toString().padStart(2, '0')}</span></div>
        <button className="new-chat-row" onClick={() => { setCreateOpen(true); setError(''); }} type="button">
          <span className="new-chat-icon"><Plus size={17} /></span><span>Nieuw privegesprek</span>
        </button>

        <nav className="conversation-list" aria-label="Jouw gesprekken">
          {conversations.map((conversation, index) => (
            <button
              className={`conversation-item${activeId === conversation.id ? ' active' : ''}`}
              key={conversation.id}
              onClick={() => { setActiveId(conversation.id); setMobileChatOpen(true); setError(''); }}
              type="button"
            >
              <span className={`conversation-avatar avatar-tone-${index % 4}`}>{initials(conversation.title)}</span>
              <span className="conversation-info">
                <span className="conversation-title">{conversation.title}</span>
                <span className="conversation-preview">{conversation.lastMessage ?? 'Nog geen berichten'}</span>
              </span>
              <span className="conversation-meta">
                {conversation.lastMessageAt && <span className="conversation-time">{formatTime(conversation.lastMessageAt)}</span>}
                <span className="member-count"><UsersRound size={12} />{conversation.memberCount ?? 1}</span>
              </span>
            </button>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <span className="privacy-note"><span className="privacy-icon"><ShieldCheck size={16} /></span><span><strong>Prive blijft prive</strong><small>Alleen via jouw uitnodiging</small></span></span>
          <div className="profile-row">
            <Avatar className="profile-avatar" name={user.name} src={user.avatar} />
            <span className="profile-info"><strong>{user.name}</strong><small>{user.email}</small></span>
            <button className="icon-button logout-button" aria-label="Profielinstellingen" onClick={() => setProfileSettingsOpen(true)} title="Profielinstellingen" type="button"><Settings2 size={16} /></button>
            <button className="icon-button logout-button" aria-label="Uitloggen" onClick={() => void logOut()} title="Uitloggen" type="button"><LogOut size={16} /></button>
          </div>
        </div>
      </aside>

      <section className={`chat-main${mobileChatOpen ? ' chat-main-visible-mobile' : ''}`}>
        {activeConversation ? (
          <>
            <header className="chat-header">
              <button className="icon-button back-button" aria-label="Terug naar gesprekken" onClick={() => setMobileChatOpen(false)} type="button"><ArrowLeft size={19} /></button>
              <span className="header-avatar">{initials(activeConversation.title)}</span>
              <div className="header-details"><h1>{activeConversation.title}</h1><span><span className="header-online-dot" />{Math.max(onlineUserIds.length - 1, 0)} anderen online <span className="header-divider">·</span> {activeConversation.memberCount ?? 1} leden</span></div>
              <div className="header-actions">
                <button className="share-button" onClick={() => void copyInviteLink()} type="button"><Link2 size={16} /><span>{copied ? 'Gekopieerd' : 'Nodig uit'}</span><Copy className="share-copy-icon" size={14} /></button>
                {(activeConversation.myRole === 'owner' || activeConversation.myRole === 'admin') && <button className="icon-button renew-button" aria-label="Uitnodigingslink vernieuwen" disabled={busy} onClick={() => void renewInviteLink()} title="Vorige link intrekken en vernieuwen" type="button"><ShieldCheck size={18} /></button>}
                <button className="icon-button group-settings-button" aria-label="Groepsinstellingen" onClick={() => void openGroupSettings()} title="Groepsinstellingen" type="button"><Settings2 size={18} /></button>
              </div>
            </header>

            <div className="message-scroll">
              {messages.length === 0 ? (
                <div className="empty-conversation">
                  <span className="empty-chat-icon"><MessageCircle size={28} /></span>
                  <span className="empty-eyebrow">EEN NIEUW GESPREK BEGINT HIER</span>
                  <h2>Zeg als eerste hallo.</h2>
                  <p>Deel de uitnodigingslink met je vrienden en begin maar.</p>
                  <button className="text-action" onClick={() => void copyInviteLink()} type="button"><Link2 size={15} /> Kopieer uitnodigingslink <ArrowRight size={15} /></button>
                </div>
              ) : (
                <div className="message-list">
                  <div className="conversation-start"><span className="conversation-start-icon"><UsersRound size={16} /></span><span>Jij en je vrienden zijn hier prive.</span></div>
                  {messages.map((message, index) => {
                    const mine = message.userId === user.id;
                    const previous = messages[index - 1];
                    const showName = !mine && (!previous || previous.userId !== message.userId);
                    return (
                      <article className={`message-row${mine ? ' mine' : ''}${showName ? ' with-name' : ''}`} key={message.id}>
                        {!mine && <Avatar className={`message-avatar${showName ? '' : ' message-avatar-hidden'}`} name={message.userName} src={showName ? message.userAvatar : null} />}
                        <div className="message-content">
                          {showName && <span className="message-sender">{message.userName}</span>}
                          <div className="message-line"><p className="message-bubble">{message.body}</p><time className="message-time" dateTime={message.createdAt}>{formatTime(message.createdAt)}</time></div>
                        </div>
                      </article>
                    );
                  })}
                  <div ref={listEndRef} />
                </div>
              )}
            </div>

            <footer className="composer-area">
              {error && <div className="inline-error" role="alert">{error}<button aria-label="Melding sluiten" onClick={() => setError('')} type="button"><X size={14} /></button></div>}
              <form className="composer" onSubmit={(event) => void sendMessage(event)}>
                <textarea aria-label="Bericht" maxLength={2000} onChange={(event) => setDraft(event.target.value)} onKeyDown={handleMessageKeyDown} placeholder={`Bericht aan ${activeConversation.title}...`} rows={1} value={draft} />
                <div className="composer-tools"><span className="composer-hint">Enter om te sturen <span>·</span> Shift + Enter voor een nieuwe regel</span><button className="send-button" aria-label="Bericht sturen" disabled={!draft.trim()} type="submit"><Send size={17} /></button></div>
              </form>
              <span className="composer-footnote">Een rustig plekje, alleen voor jullie.</span>
            </footer>
          </>
        ) : (
          <div className="welcome-empty">
            <div className="welcome-decoration" aria-hidden="true"><span className="welcome-sun" /><span className="welcome-message"><MessageCircle size={28} /></span><span className="welcome-spark">✳</span></div>
            <span className="empty-eyebrow">WELKOM BIJ CHAT</span>
            <h1>Begin met je <em>eigen mensen.</em></h1>
            <p>Maak een privegesprek en nodig vrienden uit met een link.</p>
            <button className="primary-button" onClick={() => setCreateOpen(true)} type="button"><Plus size={17} /> Maak een gesprek <ArrowRight size={16} /></button>
          </div>
        )}
      </section>

      {error && activeConversation && <div className="toast toast-error" role="alert">{error}<button aria-label="Melding sluiten" onClick={() => setError('')} type="button"><X size={15} /></button></div>}
      {notice && <div className="toast" role="status"><Check size={16} />{notice}</div>}

      {createOpen && (
        <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setCreateOpen(false); }}>
          <section aria-labelledby="create-title" aria-modal="true" className="create-modal" role="dialog">
            <button className="icon-button modal-close" aria-label="Venster sluiten" onClick={() => setCreateOpen(false)} type="button"><X size={18} /></button>
            <span className="modal-icon"><MessagesSquare size={21} /></span>
            <span className="empty-eyebrow">ALLEEN VOOR JULLIE</span>
            <h2 id="create-title">Nieuw gesprek</h2>
            <p>Geef jullie chat een naam. Je vrienden kunnen er zo bij via een link.</p>
            <form onSubmit={(event) => void createConversation(event)}>
              <label className="field-label">Naam van het gesprek
                <input autoFocus maxLength={48} minLength={2} onChange={(event) => setNewTitle(event.target.value)} placeholder="Bijvoorbeeld: Weekendplannen" required value={newTitle} />
              </label>
              {error && <p className="form-error" role="alert">{error}</p>}
              <button className="primary-button modal-submit" disabled={busy || newTitle.trim().length < 2} type="submit">{busy ? 'Bezig...' : 'Gesprek maken'}{!busy && <ArrowRight size={16} />}</button>
            </form>
          </section>
        </div>
      )}

      {groupSettingsOpen && activeConversation && (
        <GroupSettings
          conversation={activeConversation}
          members={members}
          onClose={() => setGroupSettingsOpen(false)}
          onMembersChanged={async () => {
            await loadMembers(activeConversation.id);
            await refreshConversations(activeConversation.id);
          }}
          onConversationChanged={(conversation) => {
            setConversations((current) => current.map((item) => item.id === conversation.id ? conversation : item));
            setGroupSettingsOpen(false);
            setNotice('Groepsnaam aangepast.');
          }}
          onLeave={leaveConversation}
          onDelete={deleteConversation}
        />
      )}

      {profileSettingsOpen && (
        <ProfileSettings
          user={user}
          onClose={() => setProfileSettingsOpen(false)}
          onSaved={(updatedUser) => {
            setUser(updatedUser);
            setNotice('Je profiel is bijgewerkt.');
          }}
        />
      )}
    </main>
  );
}

export default App;