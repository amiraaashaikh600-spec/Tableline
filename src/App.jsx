import { lazy, Suspense, useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  ArrowDown, ArrowRight, ArrowUpRight, CalendarDays, Check, ChevronDown, Clock3,
  Compass, Heart, MapPin, Menu, Search, Sparkles, Star, Users, Utensils, X,
} from 'lucide-react';
import { api, jsonBody } from './api.js';
import { bookingSlots } from './data.js';
import CustomerChatbox from './CustomerChatbox.jsx';

const today = () => new Date().toISOString().slice(0, 10);
const firstBookableTime = restaurant => {
  const open = Number(restaurant.openingTime.slice(0, 2)) * 60 + Number(restaurant.openingTime.slice(3));
  const close = Number(restaurant.closingTime.slice(0, 2)) * 60 + Number(restaurant.closingTime.slice(3));
  return bookingSlots.find(slot => {
    const start = Number(slot.slice(0, 2)) * 60 + Number(slot.slice(3));
    return start >= open && start + 90 <= close;
  }) || '19:00';
};
const dateLabel = value => new Date(`${value}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
const cuisineFilters = ['All', 'Italian', 'Japanese', 'Spanish', 'Indian', 'Modern British'];
const Dashboard = lazy(() => import('./Dashboard.jsx'));

export default function App() {
  const location = useLocation();
  const navigate = useNavigate();
  const restaurantId = location.pathname.match(/^\/restaurants\/([a-f\d]{24})$/i)?.[1] || '';
  const [user, setUser] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [restaurants, setRestaurants] = useState([]);
  const [restaurantsLoading, setRestaurantsLoading] = useState(true);
  const [restaurantsError, setRestaurantsError] = useState('');
  const [criteria, setCriteria] = useState({ search: '', cuisine: '', partySize: 2 });
  const [sortMode, setSortMode] = useState('newest');
  const [search, setSearch] = useState('');
  const [cuisine, setCuisine] = useState('All');
  const [date, setDate] = useState(today());
  const [partySize, setPartySize] = useState(2);
  const [favorites, setFavorites] = useState(() => {
    try { const value = JSON.parse(localStorage.getItem('tableline-favorites') || '[]'); return Array.isArray(value) ? value.filter(item => typeof item === 'string') : []; } catch { return []; }
  });
  const [modal, setModal] = useState(null);
  const [selectedRestaurant, setSelectedRestaurant] = useState(null);
  const [resumeBooking, setResumeBooking] = useState(false);
  const [notice, setNotice] = useState('');
  const [assistantPreference, setAssistantPreference] = useState('');
  const [recommendations, setRecommendations] = useState(null);
  const [assistantBusy, setAssistantBusy] = useState(false);
  const [routeRestaurant, setRouteRestaurant] = useState(null);
  const [routeLoading, setRouteLoading] = useState(false);

  useEffect(() => {
    let current = true;
    api('/auth/me').then(({ user: currentUser }) => { if (current) setUser(currentUser); })
      .catch(() => { if (current) setUser(null); })
      .finally(() => { if (current) setAuthReady(true); });
    return () => { current = false; };
  }, []);

  useEffect(() => {
    if (location.pathname !== '/') return;
    let current = true;
    setRestaurantsLoading(true);
    setRestaurantsError('');
    const params = new URLSearchParams();
    if (criteria.search) params.set('search', criteria.search);
    if (criteria.cuisine) params.set('cuisine', criteria.cuisine);
    params.set('partySize', String(criteria.partySize));
    params.set('sort', sortMode);
    api(`/restaurants?${params}`)
      .then(rows => { if (current) setRestaurants(rows); })
      .catch(error => { if (current) setRestaurantsError(error.message); })
      .finally(() => { if (current) setRestaurantsLoading(false); });
    return () => { current = false; };
  }, [criteria, sortMode, location.pathname]);

  useEffect(() => {
    if (!restaurantId) { setRouteRestaurant(null); return undefined; }
    let current = true;
    setRouteLoading(true);
    api(`/restaurants/${restaurantId}`).then(place => { if (current) setRouteRestaurant(place); })
      .catch(() => { if (current) setRouteRestaurant(null); })
      .finally(() => { if (current) setRouteLoading(false); });
    return () => { current = false; };
  }, [restaurantId]);

  useEffect(() => {
    if (!notice) return undefined;
    const timeout = window.setTimeout(() => setNotice(''), 4000);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  const toast = message => setNotice(message);
  const openSignIn = owner => setModal({ type: 'auth', owner });
  const saveSession = currentUser => {
    setUser(currentUser);
    setModal(resumeBooking && currentUser.role === 'customer' ? { type: 'booking' } : null);
    setResumeBooking(false);
    toast(`Welcome${currentUser.name ? `, ${currentUser.name.split(' ')[0]}` : ''}.`);
  };
  const login = async payload => {
    const result = await api('/auth/login', { method: 'POST', body: jsonBody(payload) });
    saveSession(result.user);
  };
  const register = async payload => {
    const result = await api('/auth/register', { method: 'POST', body: jsonBody(payload) });
    saveSession(result.user);
  };
  const signOut = async () => {
    try { await api('/auth/logout', { method: 'POST' }); }
    catch { /* Clear local UI state even if the API is unreachable. */ }
    finally { setUser(null); navigate('/'); setModal(null); toast('You have signed out.'); }
  };
  const applySearch = event => {
    event.preventDefault();
    setCriteria({ search: search.trim(), cuisine: cuisine === 'All' ? '' : cuisine, partySize });
    document.getElementById('restaurant-list')?.scrollIntoView({ behavior: 'smooth' });
  };
  const chooseCuisine = next => {
    setCuisine(next);
    setCriteria(current => ({ ...current, cuisine: next === 'All' ? '' : next }));
  };
  const toggleFavorite = restaurantId => {
    const next = favorites.includes(restaurantId) ? favorites.filter(id => id !== restaurantId) : [...favorites, restaurantId];
    setFavorites(next);
    try { localStorage.setItem('tableline-favorites', JSON.stringify(next)); } catch { /* Favorites remain available for this session. */ }
  };
  const startBooking = restaurant => {
    setSelectedRestaurant(restaurant);
    if (!user) {
      setResumeBooking(true);
      openSignIn(false);
      toast('Sign in or create an account to request a table.');
      return;
    }
    if (user.role !== 'customer') {
      toast('Restaurant owner accounts cannot make customer reservations.');
      return;
    }
    setModal({ type: 'booking' });
  };
  const askAssistant = async event => {
    event.preventDefault();
    setAssistantBusy(true);
    setRecommendations(null);
    try {
      const result = await api('/assistant/recommend', {
        method: 'POST',
        body: jsonBody({ cuisine: cuisine === 'All' ? '' : cuisine, location: search.trim(), partySize, preference: assistantPreference }),
      });
      setRecommendations(result);
    } catch (error) {
      setRecommendations({ error: error.message, restaurants: [] });
    } finally {
      setAssistantBusy(false);
    }
  };

  if (location.pathname === '/dashboard') {
    return <Suspense fallback={<div className="dashboard-loading"><span /><span /><span /></div>}><Dashboard user={user} authReady={authReady} onSignOut={signOut} onExplore={() => navigate('/')} onSignIn={() => { navigate('/'); openSignIn(false); }} toast={toast} /></Suspense>;
  }

  if (restaurantId) return <RestaurantPage restaurant={routeRestaurant} loading={routeLoading} user={user} authReady={authReady} onAuth={() => openSignIn(false)} onOwnerAuth={() => openSignIn(true)} onDashboard={() => navigate('/dashboard')} onSignOut={signOut} onBook={() => routeRestaurant && startBooking(routeRestaurant)} modal={modal} selectedRestaurant={selectedRestaurant} setModal={setModal} login={login} register={register} navigate={navigate} />;

  return <div className="app-shell">
    <Header user={user} authReady={authReady} onAuth={() => openSignIn(false)} onOwnerAuth={() => openSignIn(true)} onDashboard={() => navigate('/dashboard')} onSignOut={signOut} />
    <main>
      <section className="hero">
        <div className="hero-copy">
          <span className="eyebrow"><i /> THE CITY IS YOURS TO TASTE</span>
          <h1>A table for<br /><em>your kind</em> of night.</h1>
          <p>Find the little places you will want to come back to. Your next favourite table is closer than you think.</p>
          <a href="#discover" className="hero-link">Find your table <ArrowDown size={15} /></a>
          <div className="hero-proof">
            <span className="proof-icon"><Utensils size={15} /></span>
            <div><strong>Independent restaurants</strong><small>Made for memorable evenings</small></div>
            <span className="proof-stars"><Star size={13} fill="currentColor" /> Personal picks</span>
          </div>
        </div>
        <div className="hero-photo">
          <img src="https://images.unsplash.com/photo-1414235077428-338989a2e8c0?auto=format&fit=crop&w=1700&q=90" alt="Candlelit table set for dinner" />
          <div className="photo-caption"><span>THE LONG WAY ROUND</span><strong>Good food. Better company.</strong></div>
          <span className="photo-index">01 — A CITY FULL OF STORIES</span>
        </div>
      </section>

      <section className="search-band" id="discover">
        <div className="search-heading"><span className="section-kicker">MAKE A PLAN</span><h2>Find your table.</h2></div>
        <form className="search-panel" onSubmit={applySearch}>
          <label className="search-field search-location"><MapPin size={18} /><span><small>WHERE</small><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Restaurant or neighbourhood" /></span></label>
          <label className="search-field"><CalendarDays size={18} /><span><small>WHEN</small><input type="date" min={today()} value={date} onChange={event => setDate(event.target.value)} /></span></label>
          <label className="search-field search-party"><Users size={18} /><span><small>WHO</small><select value={partySize} onChange={event => setPartySize(Number(event.target.value))}>{Array.from({ length: 30 }, (_, index) => index + 1).map(size => <option key={size} value={size}>{size} {size === 1 ? 'guest' : 'guests'}</option>)}</select></span><ChevronDown size={14} /></label>
          <button className="search-submit"><Search size={17} /> <span>Find a table</span></button>
        </form>
        <div className="search-assurance"><span><i /> Live availability in the booking flow</span><span>Free to reserve</span></div>
      </section>

      <section className="listing-section" id="restaurant-list">
        <div className="listing-sort"><label>Sort by<select value={sortMode} onChange={event => setSortMode(event.target.value)}><option value="newest">Recently added</option><option value="name">Restaurant name</option><option value="cuisine">Cuisine</option></select></label></div>
        <div className="listing-header"><div><span className="section-kicker">THE NEIGHBOURHOOD EDIT</span><h2>Good things, <em>close by.</em></h2></div><p>Considered kitchens, warm rooms and the kind of welcome that makes an evening.</p></div>
        <div className="filter-row"><div className="filters" aria-label="Filter by cuisine">{cuisineFilters.map(item => <button key={item} className={cuisine === item ? 'filter active' : 'filter'} aria-pressed={cuisine === item} onClick={() => chooseCuisine(item)}>{item}</button>)}</div><span className="result-count">{restaurantsLoading ? 'UPDATING PLACES' : `${restaurants.length} ${restaurants.length === 1 ? 'PLACE' : 'PLACES'}`}</span></div>
        {restaurantsError ? <InlineState title="We could not load the restaurants." message={restaurantsError} action="Try again" onAction={() => setCriteria(current => ({ ...current }))} /> : restaurantsLoading ? <LoadingGrid /> : restaurants.length ? <div className="restaurant-grid">{restaurants.map((restaurant, index) => <RestaurantCard key={restaurant._id} restaurant={restaurant} index={index} favorite={favorites.includes(restaurant._id)} onFavorite={() => toggleFavorite(restaurant._id)} onOpen={() => setModal({ type: 'detail', restaurant })} onBook={() => startBooking(restaurant)} />)}</div> : <InlineState title="No places match that search." message="Try a nearby area, another cuisine or a smaller party." action="Clear filters" onAction={() => { setSearch(''); setCuisine('All'); setPartySize(2); setCriteria({ search: '', cuisine: '', partySize: 2 }); }} />}
      </section>

      <section className="ai-section">
        <div className="ai-copy"><span className="section-kicker">A LITTLE HELP FROM OUR FRIEND</span><h2>The right place for<br /><em>your kind of evening.</em></h2><p>Tell us the mood, the occasion or that dish you have been dreaming about. We will find a few places from the restaurants in Tableline.</p>
          <form className="ai-input-wrap" onSubmit={askAssistant}><Sparkles size={17} /><input aria-label="Describe the evening" placeholder="Cosy, great pasta, not too loud…" value={assistantPreference} onChange={event => setAssistantPreference(event.target.value)} maxLength={400} required /><button disabled={assistantBusy}>{assistantBusy ? 'Finding places…' : <>Ask Tableline <ArrowRight size={15} /></>}</button></form>
          {recommendations && <div className={recommendations.error ? 'ai-answer ai-error' : 'ai-answer'}>{recommendations.error ? <p>{recommendations.error}</p> : <>{recommendations.mode === 'demo' && <small className="demo-mode-label">Demo suggestions · not AI-generated</small>}<p>{recommendations.message}</p><div>{recommendations.restaurants.map(restaurant => <button key={restaurant._id} onClick={() => setModal({ type: 'detail', restaurant })}>{restaurant.name} <ArrowUpRight size={13} /></button>)}</div></>}</div>}
          <small className="ai-disclaimer">Suggestions come from listed restaurants. You choose and make every reservation.</small>
        </div>
        <div className="ai-image"><img src="https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?auto=format&fit=crop&w=1000&q=85" alt="A softly lit restaurant interior" /><span>A good night starts somewhere.</span><Sparkles size={18} /></div>
      </section>

      <section className="steps-section" id="how"><span className="section-kicker">GOOD PLANS, MADE EASY</span><h2>From “shall we?”<br />to <em>“see you there.”</em></h2><div className="steps-grid"><Step number="01" title="Find your feeling" text="Tell us when, where and who is coming. We will show you places with tables for your party." /><Step number="02" title="Choose your place" text="Explore the details, pick your favourite and choose a time that feels right." /><Step number="03" title="It is a date" text="Send a reservation request. The restaurant will confirm your table." /></div></section>

      <section className="owner-banner"><div className="owner-art"><img src="https://images.unsplash.com/photo-1559339352-11d035aa65de?auto=format&fit=crop&w=1000&q=85" alt="A restaurant team setting the dining room" /><span>MADE FOR INDEPENDENTS</span></div><div className="owner-copy"><span className="section-kicker">FOR THE PEOPLE BEHIND THE TABLE</span><h2>Your restaurant.<br /><em>More regulars.</em></h2><p>Keep your tables moving and give new guests a reason to find you. Manage reservations and your table plan in one place.</p><button className="light-cta" onClick={() => openSignIn(true)}>Bring your restaurant to Tableline <ArrowRight size={16} /></button></div></section>
    </main>
    <Footer onOwner={() => openSignIn(true)} />

    {notice && <div className="toast" role="status"><Check size={15} /> {notice}<button aria-label="Dismiss message" onClick={() => setNotice('')}><X size={14} /></button></div>}
    <AppOverlay modal={modal} setModal={setModal} selectedRestaurant={selectedRestaurant} login={login} register={register} startBooking={startBooking} date={date} partySize={partySize} navigate={navigate} toast={toast} />
    <CustomerChatbox partySize={partySize} cuisine={cuisine === 'All' ? '' : cuisine} location={search} />
  </div>;
}

function RestaurantPage({ restaurant, loading, user, authReady, onAuth, onOwnerAuth, onDashboard, onSignOut, onBook, modal, selectedRestaurant, setModal, login, register, navigate }) {
  return <div className="app-shell">
    <Header user={user} authReady={authReady} onAuth={onAuth} onOwnerAuth={onOwnerAuth} onDashboard={onDashboard} onSignOut={onSignOut} />
    <main className="restaurant-page-main"><Link className="restaurant-back-link" to="/">← Back to all restaurants</Link>{loading ? <div className="inline-state"><h2>Loading restaurant…</h2></div> : restaurant ? <div className="restaurant-page-card"><div className="restaurant-page-image"><RestaurantImage restaurant={restaurant} /></div><div className="restaurant-page-copy"><span className="section-kicker">{restaurant.cuisine}</span><h1>{restaurant.name}</h1><p className="detail-loc"><MapPin size={14} /> {restaurant.address}</p><p>{restaurant.description}</p><div className="detail-hours"><Clock3 size={15} /> Opening hours <b>{restaurant.openingTime} – {restaurant.closingTime}</b></div><div className="restaurant-page-tables"><strong>Seating</strong><span>{restaurant.tables?.map(table => `${table.capacity} seats`).filter((value, index, list) => list.indexOf(value) === index).join(' · ') || 'Availability varies by date'}</span></div><button className="dark-cta" onClick={onBook}>Check available tables <ArrowRight size={15} /></button></div></div> : <div className="inline-state"><h2>Restaurant not found.</h2><p>This listing may have been removed or is awaiting approval.</p><Link className="text-link" to="/">Browse restaurants <ArrowRight size={14} /></Link></div>}</main>
    <Footer onOwner={onOwnerAuth} />
    <AppOverlay modal={modal} setModal={setModal} selectedRestaurant={selectedRestaurant} login={login} register={register} startBooking={startBooking} date={new Date().toISOString().slice(0, 10)} partySize={2} navigate={navigate} toast={toast} />
  </div>;
}

function AppOverlay({ modal, setModal, selectedRestaurant, login, register, startBooking, date, partySize, navigate }) {
  if (!modal) return null;
  return <Modal onClose={() => setModal(null)} wide={modal.type === 'booking'}>
    {modal.type === 'auth' && <AuthDialog ownerDefault={modal.owner} onLogin={login} onRegister={register} />}
    {modal.type === 'detail' && <RestaurantDetail restaurant={modal.restaurant} onBook={() => startBooking(modal.restaurant)} />}
    {modal.type === 'booking' && selectedRestaurant && <BookingDialog restaurant={selectedRestaurant} date={date} partySize={partySize} onSubmit={async payload => { const booking = await api('/bookings', { method: 'POST', body: jsonBody(payload) }); setModal({ type: 'success', booking }); }} />}
    {modal.type === 'success' && <SuccessDialog restaurant={selectedRestaurant} booking={modal.booking} onDashboard={() => { setModal(null); navigate('/dashboard'); }} onClose={() => setModal(null)} />}
  </Modal>;
}

function Header({ user, authReady, onAuth, onOwnerAuth, onDashboard, onSignOut }) {
  const [menuOpen, setMenuOpen] = useState(false);
  return <header className="topbar"><Link to="/" className="brand"><span className="brand-mark"><Utensils size={16} /></span><span>tableline<span className="brand-period">.</span></span></Link><nav className={menuOpen ? 'nav-links open' : 'nav-links'}><a href="#restaurant-list" onClick={() => setMenuOpen(false)}>Discover</a><a href="#how" onClick={() => setMenuOpen(false)}>How it works</a><button className="nav-text mobile-owner-link" onClick={() => { setMenuOpen(false); onOwnerAuth(); }}>For restaurants</button><button className="nav-text" onClick={() => { setMenuOpen(false); onDashboard(); }}>{user?.role === 'owner' ? 'Owner dashboard' : 'My reservations'}</button><div className="mobile-auth-links">{user ? <button className="nav-text" onClick={() => { setMenuOpen(false); onSignOut(); }}>Sign out</button> : <button className="nav-text" onClick={() => { setMenuOpen(false); onAuth(); }}>Log in</button>}</div></nav><div className="nav-actions">{user ? <><button className="user-chip" onClick={onDashboard}><span>{user.name?.[0]?.toUpperCase()}</span>{user.name?.split(' ')[0]}</button><button className="login-button" onClick={onSignOut}>Sign out</button></> : <><button className="login-button" onClick={onAuth} disabled={!authReady}>Log in</button><button className="owner-button" onClick={onOwnerAuth}>For restaurants <ArrowUpRight size={14} /></button></>}</div><button className="header-menu-toggle" aria-label="Toggle navigation" aria-expanded={menuOpen} onClick={() => setMenuOpen(open => !open)}><Menu size={20} /><span>Menu</span></button></header>;
}

function RestaurantCard({ restaurant, index, favorite, onFavorite, onOpen, onBook }) {
  return <article className="restaurant-card"><div className="card-image-wrap"><button className="card-image" onClick={onOpen} aria-label={`View ${restaurant.name}`}><RestaurantImage restaurant={restaurant} /></button><span className="card-index">{String(index + 1).padStart(2, '0')}</span><button className={favorite ? 'card-save saved' : 'card-save'} aria-label={favorite ? `Remove ${restaurant.name} from saved restaurants` : `Save ${restaurant.name}`} aria-pressed={favorite} onClick={onFavorite}><Heart size={16} fill={favorite ? 'currentColor' : 'none'} /></button></div><div className="card-info"><div className="card-overline"><span>{restaurant.cuisine}</span><span><Clock3 size={12} /> {restaurant.openingTime} – {restaurant.closingTime}</span></div><button className="card-title" onClick={onOpen}>{restaurant.name}</button><div className="card-location"><MapPin size={13} /> {restaurant.address}</div>{restaurant.description && <p>{restaurant.description}</p>}<div className="card-bottom"><span className="availability-label"><i /> Capacity for your party</span><button className="book-link" onClick={onBook}>Choose a time <ArrowRight size={15} /></button></div></div></article>;
}

function RestaurantImage({ restaurant }) {
  const [failed, setFailed] = useState(false);
  return restaurant.imageUrl && !failed ? <img src={restaurant.imageUrl} alt={`${restaurant.name} dining room`} loading="lazy" onError={() => setFailed(true)} /> : <div className="image-placeholder"><Utensils size={25} /><span>Restaurant photo</span></div>;
}

function Step({ number, title, text }) { return <article className="step"><div className="step-top"><span>{number}</span><span><Compass size={16} /></span></div><h3>{title}</h3><p>{text}</p></article>; }

function InlineState({ title, message, action, onAction }) { return <div className="inline-state"><Compass size={24} /><h3>{title}</h3><p>{message}</p>{action && <button className="text-link" onClick={onAction}>{action} <ArrowRight size={14} /></button>}</div>; }
function LoadingGrid() { return <div className="restaurant-grid loading-grid" aria-label="Loading restaurants">{[1, 2, 3].map(item => <div className="loading-card" key={item}><span /><i /><i /><i /></div>)}</div>; }

function Footer({ onOwner }) { return <footer className="footer"><Link to="/" className="brand"><span className="brand-mark"><Utensils size={15} /></span><span>tableline<span className="brand-period">.</span></span></Link><span>Good food brings us together.</span><span>© {new Date().getFullYear()} Tableline</span><div><a href="#discover">Discover</a><button onClick={onOwner}>For restaurants</button></div></footer>; }

function Modal({ children, onClose, wide }) {
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKeyDown = event => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKeyDown);
    return () => { document.body.style.overflow = previous; window.removeEventListener('keydown', onKeyDown); };
  }, [onClose]);
  return <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}><section className={wide ? 'modal modal-wide' : 'modal'} role="dialog" aria-modal="true"><button className="modal-close" aria-label="Close dialog" onClick={onClose}><X size={18} /></button>{children}</section></div>;
}

function AuthDialog({ ownerDefault, onLogin, onRegister }) {
  const [mode, setMode] = useState('register');
  const [accountRole, setAccountRole] = useState(ownerDefault ? 'owner' : 'customer');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async event => {
    event.preventDefault(); setBusy(true); setError('');
    const form = new FormData(event.currentTarget);
    const payload = mode === 'login'
      ? { email: form.get('email'), password: form.get('password') }
      : { name: form.get('name'), email: form.get('email'), password: form.get('password'), phone: form.get('phone'), role: accountRole };
    try { await (mode === 'login' ? onLogin(payload) : onRegister(payload)); }
    catch (submitError) { setError(submitError.message); }
    finally { setBusy(false); }
  };
  return <div className="auth-modal"><span className="section-kicker">{accountRole === 'owner' && mode === 'register' ? 'A SEAT AT THE TABLE' : 'WELCOME TO TABLELINE'}</span><h2>{mode === 'login' ? <>Good to see<br /><em>you again.</em></> : <>Let us get<br /><em>acquainted.</em></>}</h2><p>{accountRole === 'owner' && mode === 'register' ? 'Bring your restaurant to the diners who are looking for it.' : 'Save your plans and keep your reservations in one place.'}</p><div className="auth-tabs"><button className={mode === 'login' ? 'selected' : ''} onClick={() => { setMode('login'); setError(''); }}>Log in</button><button className={mode === 'register' ? 'selected' : ''} onClick={() => { setMode('register'); setError(''); }}>Create account</button></div><form onSubmit={submit} className="auth-form">{mode === 'register' && <label>Your name<input name="name" minLength="2" maxLength="80" autoComplete="name" placeholder="First and last name" required /></label>}<label>Email address<input name="email" type="email" maxLength="254" autoComplete="email" placeholder="you@example.com" required /></label><label>Password<input name="password" type="password" minLength="10" maxLength="128" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} placeholder="At least 10 characters" required /></label>{mode === 'register' && <><label>Phone <span className="optional-label">optional</span><input name="phone" type="tel" autoComplete="tel" placeholder="+44…" /></label><label>I am here as<select value={accountRole} onChange={event => setAccountRole(event.target.value)}><option value="customer">A diner</option><option value="owner">A restaurant owner</option></select></label></>}{error && <p className="form-error" role="alert">{error}</p>}<button className="dark-cta full-cta" disabled={busy}>{busy ? 'Please wait…' : mode === 'login' ? 'Log in' : 'Create my account'} <ArrowRight size={15} /></button></form></div>;
}

function RestaurantDetail({ restaurant, onBook }) {
  return <div className="detail-modal"><RestaurantImage restaurant={restaurant} /><div className="detail-content"><span className="section-kicker">{restaurant.cuisine}</span><h2>{restaurant.name}</h2><div className="detail-loc"><MapPin size={14} /> {restaurant.address}</div><p>{restaurant.description || 'A local restaurant ready to welcome you.'}</p><div className="detail-hours"><Clock3 size={15} /> Opening hours <b>{restaurant.openingTime} – {restaurant.closingTime}</b></div><button className="dark-cta full-cta" onClick={onBook}>Check available tables <ArrowRight size={15} /></button><small className="booking-foot"><Check size={12} /> The restaurant confirms your reservation request</small></div></div>;
}

function BookingDialog({ restaurant, date: initialDate, partySize: initialPartySize, onSubmit }) {
  const [date, setDate] = useState(initialDate);
  const [partySize, setPartySize] = useState(initialPartySize);
  const [time, setTime] = useState(() => firstBookableTime(restaurant));
  const [tables, setTables] = useState([]);
  const [tableId, setTableId] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let current = true;
    const refresh = () => api(`/availability?restaurantId=${restaurant._id}&date=${date}&time=${time}&partySize=${partySize}`)
      .then(available => { if (current) { setTables(available); setTableId(currentId => available.some(table => table._id === currentId) ? currentId : available[0]?._id || ''); setError(''); } })
      .catch(requestError => { if (current) { setTables([]); setTableId(''); setError(requestError.message); } })
      .finally(() => { if (current) setLoading(false); });
    setLoading(true);
    refresh();
    const onAvailabilityChanged = event => { if (event.restaurantId === restaurant._id && (!event.bookingDate || event.bookingDate === date)) refresh(); };
    let socket;
    import('socket.io-client').then(({ io }) => {
      if (!current) return;
      socket = io({ withCredentials: true });
      socket.emit('availability:watch', { restaurantId: restaurant._id });
      socket.on('availability:changed', onAvailabilityChanged);
    }).catch(() => {});
    const interval = window.setInterval(() => { if (!document.hidden) refresh(); }, 12000);
    return () => { current = false; window.clearInterval(interval); socket?.off('availability:changed', onAvailabilityChanged); socket?.disconnect(); };
  }, [restaurant._id, date, time, partySize]);

  const submit = async event => {
    event.preventDefault(); setSubmitting(true); setError('');
    const form = new FormData(event.currentTarget);
    try { await onSubmit({ restaurantId: restaurant._id, tableId, bookingDate: date, startTime: time, partySize, notes: form.get('notes') }); }
    catch (submitError) { setError(submitError.message); }
    finally { setSubmitting(false); }
  };
  const openingMinutes = Number(restaurant.openingTime.slice(0, 2)) * 60 + Number(restaurant.openingTime.slice(3));
  const times = bookingSlots.filter(slot => {
    const [hour, minute] = slot.split(':').map(Number);
    const start = hour * 60 + minute;
    const end = start + 90;
    const [closeHour, closeMinute] = restaurant.closingTime.split(':').map(Number);
    const close = closeHour * 60 + closeMinute;
    return start >= openingMinutes && end <= close;
  });

  return <div className="booking-modal"><div className="booking-cover"><RestaurantImage restaurant={restaurant} /><span className="cover-shade" /><div><span className="section-kicker">MAKE IT A DATE</span><h2>{restaurant.name}</h2><span><MapPin size={13} />{restaurant.address}</span></div></div><form onSubmit={submit}><div className="booking-controls"><label><small>DATE</small><input type="date" min={today()} value={date} onChange={event => setDate(event.target.value)} required /></label><label><small>GUESTS</small><select value={partySize} onChange={event => setPartySize(Number(event.target.value))}>{Array.from({ length: 30 }, (_, index) => index + 1).map(size => <option key={size} value={size}>{size} {size === 1 ? 'guest' : 'guests'}</option>)}</select></label></div><span className="slot-label"><Clock3 size={14} /> CHOOSE A TIME <span>· 90 minute seating</span></span><div className="time-grid">{times.map(slot => <button type="button" className={slot === time ? 'time-slot selected' : 'time-slot'} key={slot} aria-pressed={slot === time} onClick={() => setTime(slot)}>{slot}</button>)}</div><span className="slot-label table-label"><Users size={14} /> AVAILABLE TABLES <span>· refreshed every 12 seconds</span></span>{loading ? <div className="loading-line">Checking the restaurant’s live availability…</div> : error ? <div className="form-error" role="alert">{error}</div> : tables.length ? <select className="table-select" value={tableId} onChange={event => setTableId(event.target.value)} required>{tables.map(table => <option value={table._id} key={table._id}>{table.tableNumber} · up to {table.capacity} guests</option>)}</select> : <div className="no-tables">No tables are free at this time. Try another date or time.</div>}<label className="notes-label">A note for the restaurant <span>optional</span><textarea name="notes" maxLength="500" placeholder="A birthday, an allergy, a seating preference…" rows="2" /></label>{error && tables.length > 0 && <p className="form-error" role="alert">{error}</p>}<button className="dark-cta full-cta" disabled={submitting || loading || !tables.length}>{submitting ? 'Sending request…' : <>Request this table <ArrowRight size={15} /></>}</button><small className="booking-foot"><Check size={12} /> No payment needed · The restaurant confirms your request</small></form></div>;
}

function SuccessDialog({ restaurant, booking, onDashboard, onClose }) { return <div className="success-modal"><span className="success-icon"><Check size={23} /></span><span className="section-kicker">A LOVELY PLAN, LOCKED IN</span><h2>Your request is<br /><em>on its way.</em></h2><p>{restaurant?.name} has received your request for {dateLabel(booking.bookingDate)} at {booking.startTime}. You can follow its status in your reservations.</p><button className="dark-cta full-cta" onClick={onDashboard}>See my reservations <ArrowRight size={15} /></button><button className="subtle-button" onClick={onClose}>Keep exploring</button></div>; }
