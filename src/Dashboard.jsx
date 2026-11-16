import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Bell, CalendarDays, Check, Clock3, MapPin, Plus, RefreshCw, Utensils, Users, X } from 'lucide-react';
import { api } from './api.js';

const formatDate = value => new Date(`${value}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

export default function Dashboard({ user, authReady, onSignOut, onExplore, onSignIn, toast }) {
  const [bookings, setBookings] = useState([]);
  const [restaurants, setRestaurants] = useState([]);
  const [reviewRestaurants, setReviewRestaurants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  const load = async () => {
    setLoading(true); setError('');
    try {
      if (user?.role === 'owner') {
        const [places, reservations] = await Promise.all([api('/owner/restaurants'), api('/owner/bookings')]);
        setRestaurants(places); setBookings(reservations);
      } else if (user?.role === 'customer') {
        setBookings(await api('/bookings/mine'));
      } else if (user?.role === 'admin') {
        setReviewRestaurants(await api('/admin/restaurants?status=pending'));
      } else {
        setBookings([]); setRestaurants([]);
      }
    } catch (loadError) { setError(loadError.message); }
    finally { setLoading(false); }
  };

  useEffect(() => { if (authReady) load(); }, [authReady, user?.id, user?.role]);

  const updateStatus = async (id, status) => {
    try {
      await api(`/bookings/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) });
      await load();
      toast(`Reservation ${status}.`);
    } catch (actionError) { setError(actionError.message); }
  };

  if (!authReady || loading && !user) return <DashboardFrame user={user} onSignOut={onSignOut} onExplore={onExplore}><DashboardLoading /></DashboardFrame>;
  if (!user) return <DashboardFrame onExplore={onExplore}><div className="dashboard-empty"><CalendarDays size={28} /><h1>Sign in to see your plans.</h1><p>Your bookings and restaurant tools are connected to your account.</p><button className="dark-cta" onClick={onSignIn}>Log in or create an account <ArrowRight size={15} /></button><button className="subtle-button" onClick={onExplore}>Back to Tableline</button></div></DashboardFrame>;

  return <DashboardFrame user={user} onSignOut={onSignOut} onExplore={onExplore}>
    <div className="dashboard-title"><div><span className="section-kicker">{user.role === 'owner' ? 'THE HOST’S CORNER' : 'YOUR PLANS'}</span><h1>{user.role === 'owner' ? <>Your <em>house.</em></> : <>Good things <em>ahead.</em></>}</h1><p>{user.role === 'owner' ? 'Welcome back. Here is what is happening at your restaurants.' : 'Your reservations, all in one place.'}</p></div><button className="outline-button" onClick={load} disabled={loading}><RefreshCw size={14} /> Refresh</button></div>
    {error && <div className="dashboard-error" role="alert">{error}<button onClick={load}>Try again</button></div>}
    {user.role === 'owner' ? <OwnerDashboard restaurants={restaurants} bookings={bookings} statusFilter={statusFilter} setStatusFilter={setStatusFilter} onStatus={updateStatus} onRefresh={load} onError={setError} loading={loading} /> : user.role === 'admin' ? <AdminDashboard restaurants={reviewRestaurants} loading={loading} onRefresh={load} toast={toast} /> : <CustomerDashboard bookings={bookings} statusFilter={statusFilter} setStatusFilter={setStatusFilter} onCancel={id => updateStatus(id, 'cancelled')} onExplore={onExplore} loading={loading} />}
  </DashboardFrame>;
}

function DashboardFrame({ children, user, onSignOut, onExplore }) {
  return <div className="dashboard-shell"><header className="dashboard-topbar"><Link to="/" className="brand" onClick={onExplore}><span className="brand-mark"><Utensils size={16} /></span><span>tableline<span className="brand-period">.</span></span></Link><div className="dashboard-nav"><button onClick={onExplore}><ArrowLeft size={14} /> Explore restaurants</button>{user && <><NotificationCenter /><span className="dashboard-user"><b>{user.name?.[0]?.toUpperCase()}</b>{user.name}</span><button onClick={onSignOut}>Sign out</button></>}</div></header><main className="dashboard-main">{children}</main><footer className="dashboard-footer">Tableline · Good food brings us together.</footer></div>;
}

function DashboardLoading() { return <div className="dashboard-loading"><span /><span /><span /></div>; }

function NotificationCenter() {
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    api('/notifications/mine').then(rows => { if (active) setItems(rows); }).catch(loadError => { if (active) setError(loadError.message); });
    let socket;
    import('socket.io-client').then(({ io }) => {
      if (!active) return;
      socket = io({ withCredentials: true });
      socket.on('notification:new', item => setItems(current => [item, ...current.filter(old => old._id !== item._id)].slice(0, 50)));
    }).catch(() => {});
    return () => { active = false; socket?.disconnect(); };
  }, []);
  const unread = items.filter(item => !item.readAt).length;
  const markRead = async item => {
    try {
      const updated = await api(`/notifications/${item._id}/read`, { method: 'PATCH', body: '{}' });
      setItems(current => current.map(existing => existing._id === updated._id ? updated : existing));
    } catch (readError) { setError(readError.message); }
  };
  return <div className="notification-wrap"><button className="notification-trigger" onClick={() => setOpen(value => !value)} aria-expanded={open} aria-label={`Notifications, ${unread} unread`}><Bell size={17} />{unread > 0 && <span>{unread > 9 ? '9+' : unread}</span>}</button>{open && <section className="notification-popover"><header><strong>Notifications</strong><button aria-label="Close notifications" onClick={() => setOpen(false)}><X size={15} /></button></header>{error && <p className="form-error">{error}</p>}{items.length ? items.map(item => <button className={`notification-row ${item.readAt ? '' : 'unread'}`} key={item._id} onClick={() => markRead(item)}><strong>{item.title}</strong><span>{item.message}</span><small>{new Date(item.createdAt).toLocaleString()}</small></button>) : <p className="notification-empty">You’re all caught up.</p>}</section>}</div>;
}

function AdminDashboard({ restaurants, loading, onRefresh, toast }) {
  const [busyId, setBusyId] = useState('');
  const [error, setError] = useState('');
  const review = async (restaurant, status) => {
    setBusyId(restaurant._id); setError('');
    try {
      await api(`/admin/restaurants/${restaurant._id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) });
      await onRefresh();
      toast(status === 'active' ? `${restaurant.name} approved.` : `${restaurant.name} rejected.`);
    } catch (actionError) { setError(actionError.message); }
    finally { setBusyId(''); }
  };
  return <section className="admin-review"><div className="manager-heading"><div><span className="section-kicker">PLATFORM ADMINISTRATION</span><h2>Restaurant approvals</h2><p>Review new restaurant listings before they appear in discovery.</p></div><button className="outline-button" onClick={onRefresh} disabled={loading}><RefreshCw size={14} /> Refresh</button></div>{error && <p className="form-error" role="alert">{error}</p>}{loading ? <DashboardLoading /> : restaurants.length ? restaurants.map(restaurant => <article className="admin-restaurant-card" key={restaurant._id}><div className="manager-photo">{restaurant.imageUrl ? <img src={restaurant.imageUrl} alt="" /> : <Utensils size={20} />}</div><div><span className="section-kicker">{restaurant.cuisine}</span><h3>{restaurant.name}</h3><p>{restaurant.address} · {restaurant.openingTime}–{restaurant.closingTime}</p><p>{restaurant.description}</p><small>Submitted by {restaurant.ownerId?.name} · {restaurant.ownerId?.email}</small></div><div className="admin-review-actions"><button className="dark-cta" disabled={Boolean(busyId)} onClick={() => review(restaurant, 'active')}><Check size={14} /> Approve</button><button className="outline-button" disabled={Boolean(busyId)} onClick={() => review(restaurant, 'rejected')}><X size={14} /> Reject</button></div></article>) : <div className="dashboard-empty"><Check size={26} /><h2>All caught up.</h2><p>There are no restaurant listings waiting for review.</p></div>}</section>;
}

function CustomerDashboard({ bookings, statusFilter, setStatusFilter, onCancel, onExplore, loading }) {
  const upcoming = bookings.filter(booking => ['pending', 'confirmed'].includes(booking.status));
  const history = bookings.filter(booking => ['completed', 'cancelled', 'rejected'].includes(booking.status));
  const rows = statusFilter === 'history' ? history : statusFilter === 'all' ? bookings : upcoming;
  return <><div className="dashboard-tabs"><button className={statusFilter === 'all' ? 'selected' : ''} onClick={() => setStatusFilter('all')}>All <span>{bookings.length}</span></button><button className={statusFilter === 'upcoming' ? 'selected' : ''} onClick={() => setStatusFilter('upcoming')}>Upcoming <span>{upcoming.length}</span></button><button className={statusFilter === 'history' ? 'selected' : ''} onClick={() => setStatusFilter('history')}>Past <span>{history.length}</span></button></div>
    {loading ? <DashboardLoading /> : rows.length ? <div className="customer-bookings">{rows.map(booking => <CustomerBooking key={booking._id} booking={booking} onCancel={() => onCancel(booking._id)} />)}</div> : <div className="dashboard-empty"><CalendarDays size={28} /><h2>{statusFilter === 'history' ? 'Your history starts here.' : 'Your next great meal is waiting.'}</h2><p>{statusFilter === 'history' ? 'Past reservations will appear here.' : 'You do not have reservations in this view yet.'}</p><button className="dark-cta" onClick={onExplore}>Find your table <ArrowRight size={15} /></button></div>}</>;
}

function CustomerBooking({ booking, onCancel }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const cancel = async () => { setBusy(true); setError(''); try { await onCancel(); } catch (actionError) { setError(actionError.message); } finally { setBusy(false); } };
  return <article className="customer-booking"><div className="customer-booking-photo">{booking.restaurantId?.imageUrl ? <img src={booking.restaurantId.imageUrl} alt="" /> : <Utensils size={20} />}</div><div className="customer-booking-content"><span className={`status status-${booking.status}`}>{booking.status}</span><h2>{booking.restaurantId?.name || 'Restaurant'}</h2><span className="booking-address"><MapPin size={13} /> {booking.restaurantId?.address}</span><div className="booking-facts"><span><CalendarDays size={14} /> {formatDate(booking.bookingDate)}</span><span><Clock3 size={14} /> {booking.startTime}</span><span><Users size={14} /> {booking.partySize} {booking.partySize === 1 ? 'guest' : 'guests'}</span><span><Utensils size={14} /> {booking.tableId?.tableNumber || 'Table'}</span></div>{error && <p className="form-error">{error}</p>}</div>{['pending', 'confirmed'].includes(booking.status) && <button className="cancel-button" disabled={busy} onClick={cancel}>{busy ? 'Cancelling…' : 'Cancel reservation'}</button>}</article>;
}

function OwnerDashboard({ restaurants, bookings, statusFilter, setStatusFilter, onStatus, onRefresh, onError, loading }) {
  const [tab, setTab] = useState('reservations');
  const [startAddingRestaurant, setStartAddingRestaurant] = useState(false);
  const pending = bookings.filter(booking => booking.status === 'pending').length;
  const filtered = statusFilter === 'all' ? bookings : bookings.filter(booking => booking.status === statusFilter);
  return <><div className="owner-summary"><div><span>Pending requests</span><strong>{pending}</strong></div><div><span>Your restaurants</span><strong>{restaurants.length}</strong></div><div><span>Upcoming covers</span><strong>{bookings.filter(booking => ['pending', 'confirmed'].includes(booking.status)).reduce((sum, booking) => sum + booking.partySize, 0)}</strong></div></div><div className="dashboard-tabs owner-dashboard-tabs"><button className={tab === 'reservations' ? 'selected' : ''} onClick={() => setTab('reservations')}>Reservations <span>{bookings.length}</span></button><button className={tab === 'places' ? 'selected' : ''} onClick={() => setTab('places')}>Restaurants & tables <span>{restaurants.length}</span></button><button className="add-dashboard-button" onClick={() => { setTab('places'); setStartAddingRestaurant(true); }}><Plus size={14} /> Add a restaurant</button></div>{tab === 'reservations' ? <><div className="booking-filter"><label>Show<select value={statusFilter} onChange={event => setStatusFilter(event.target.value)}><option value="all">All reservations</option><option value="pending">Pending</option><option value="confirmed">Confirmed</option><option value="completed">Completed</option><option value="rejected">Rejected</option><option value="cancelled">Cancelled</option></select></label></div>{loading ? <DashboardLoading /> : filtered.length ? <div className="owner-bookings">{filtered.map(booking => <OwnerBooking key={booking._id} booking={booking} onStatus={onStatus} />)}</div> : <div className="dashboard-empty"><CalendarDays size={26} /><h2>No reservations in this view.</h2><p>New table requests will appear here.</p></div>}</> : <RestaurantManager restaurants={restaurants} onRefresh={onRefresh} onError={onError} initialAdding={startAddingRestaurant} onAddComplete={() => setStartAddingRestaurant(false)} />}</>;
}

function OwnerBooking({ booking, onStatus }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const action = async status => { setBusy(true); setError(''); try { await onStatus(booking._id, status); } catch (actionError) { setError(actionError.message); } finally { setBusy(false); } };
  return <article className="owner-booking-card"><div className="owner-date"><b>{new Date(`${booking.bookingDate}T12:00`).toLocaleDateString('en-GB', { day: '2-digit' })}</b><span>{new Date(`${booking.bookingDate}T12:00`).toLocaleDateString('en-GB', { month: 'short' }).toUpperCase()}</span></div><div className="owner-booking-detail"><div className="owner-booking-heading"><h3>{booking.customerId?.name || 'Guest'}</h3><span className={`status status-${booking.status}`}>{booking.status}</span></div><p>{booking.restaurantId?.name} · {booking.startTime} · {booking.partySize} {booking.partySize === 1 ? 'guest' : 'guests'} · {booking.tableId?.tableNumber}</p><small>{booking.customerId?.email}</small>{error && <span className="form-error">{error}</span>}</div>{booking.status === 'pending' && <div className="owner-actions"><button title="Confirm reservation" disabled={busy} onClick={() => action('confirmed')}><Check size={15} /> Confirm</button><button title="Reject reservation" disabled={busy} onClick={() => action('rejected')}><X size={15} /> Reject</button></div>}{booking.status === 'confirmed' && <button className="outline-button" disabled={busy} onClick={() => action('completed')}>Mark completed</button>}</article>;
}

function RestaurantManager({ restaurants, onRefresh, initialAdding = false, onAddComplete }) {
  const [adding, setAdding] = useState(initialAdding);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const submitRestaurant = async event => {
    event.preventDefault(); setBusy(true); setMessage('');
    try { await api('/restaurants', { method: 'POST', body: new FormData(event.currentTarget) }); await onRefresh(); setAdding(false); onAddComplete?.(); setMessage('Restaurant submitted for admin review. Add tables now; it appears publicly after approval.'); }
    catch (error) { setMessage(error.message); }
    finally { setBusy(false); }
  };
  return <div className="restaurant-manager"><div className="manager-heading"><div><h2>Your restaurants</h2><p>Update your details and keep your table plan current.</p></div><button className="dark-cta" onClick={() => setAdding(value => !value)}><Plus size={15} /> Add a restaurant</button></div>{message && <div className="dashboard-notice" role="status">{message}<button onClick={() => setMessage('')}><X size={14} /></button></div>}{adding && <form className="restaurant-edit-form" onSubmit={submitRestaurant}><h3>Restaurant details</h3><label>Name<input name="name" minLength="2" maxLength="100" required /></label><label>Cuisine<input name="cuisine" maxLength="60" required /></label><label>Address<input name="address" maxLength="200" required /></label><label>Phone<input name="phone" maxLength="30" /></label><label>Opens<input name="openingTime" type="time" defaultValue="12:00" required /></label><label>Closes<input name="closingTime" type="time" defaultValue="22:00" required /></label><label>Time zone<input name="timeZone" defaultValue="Europe/London" placeholder="Europe/London" required /></label><label className="wide-field">Description<textarea name="description" maxLength="1500" rows="3" /></label><label className="wide-field">Restaurant image<input name="image" type="file" accept="image/jpeg,image/png,image/webp" /></label><button className="dark-cta" disabled={busy}>{busy ? 'Adding restaurant…' : 'Save restaurant'} <ArrowRight size={14} /></button></form>}{restaurants.length ? restaurants.map(restaurant => <RestaurantManagerCard key={restaurant._id} restaurant={restaurant} onRefresh={onRefresh} onError={onError} />) : !adding && <div className="dashboard-empty"><Utensils size={26} /><h2>Your place belongs here.</h2><p>Add your restaurant, image and table plan to welcome guests.</p><button className="dark-cta" onClick={() => setAdding(true)}><Plus size={15} /> Add your restaurant</button></div>}</div>;
}

function RestaurantManagerCard({ restaurant, onRefresh, onError }) {
  const [newTable, setNewTable] = useState(false);
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const saveRestaurant = async event => {
    event.preventDefault(); setBusy(true); setMessage('');
    try { await api(`/restaurants/${restaurant._id}`, { method: 'PATCH', body: new FormData(event.currentTarget) }); await onRefresh(); setEditing(null); setMessage('Restaurant details saved.'); }
    catch (error) { setMessage(error.message); onError?.(error.message); }
    finally { setBusy(false); }
  };
  const addTable = async event => {
    event.preventDefault(); setBusy(true); setMessage(''); const form = new FormData(event.currentTarget);
    try { await api(`/restaurants/${restaurant._id}/tables`, { method: 'POST', body: JSON.stringify({ tableNumber: form.get('tableNumber'), capacity: Number(form.get('capacity')) }) }); await onRefresh(); setNewTable(false); setMessage('Table added.'); }
    catch (error) { setMessage(error.message); onError?.(error.message); }
    finally { setBusy(false); }
  };
  const saveTable = async (event, table) => {
    event.preventDefault(); setBusy(true); const form = new FormData(event.currentTarget);
    try { await api(`/tables/${table._id}`, { method: 'PATCH', body: JSON.stringify({ tableNumber: form.get('tableNumber'), capacity: Number(form.get('capacity')), isActive: form.get('isActive') === 'on' }) }); await onRefresh(); setEditing(null); setMessage('Table updated.'); }
    catch (error) { setMessage(error.message); onError?.(error.message); }
    finally { setBusy(false); }
  };
  return <article className="manager-card">
    <div className="manager-card-head">
      <div className="manager-photo">{restaurant.imageUrl ? <img src={restaurant.imageUrl} alt="" /> : <Utensils size={20} />}</div>
      <div className="manager-restaurant-copy"><span className="section-kicker">{restaurant.cuisine} · <span className={`status status-${restaurant.status}`}>{restaurant.status}</span></span><h3>{restaurant.name}</h3><p><MapPin size={13} /> {restaurant.address} · {restaurant.openingTime}–{restaurant.closingTime}</p></div>
      <button className="outline-button" onClick={() => setEditing(editing === 'restaurant' ? null : 'restaurant')}>Edit details</button>
    </div>
    {restaurant.status === 'pending' && <p className="restaurant-review-note">Your listing is waiting for admin approval. It won’t appear in public search until approved.</p>}
    {restaurant.status === 'rejected' && <p className="restaurant-review-note rejected">This listing was not approved. Contact Tableline support for next steps.</p>}
    {message && <div className="dashboard-notice" role="status">{message}<button onClick={() => setMessage('')}><X size={14} /></button></div>}
    {editing === 'restaurant' && <form className="restaurant-edit-form compact" onSubmit={saveRestaurant}>
      <label>Name<input name="name" defaultValue={restaurant.name} required /></label><label>Cuisine<input name="cuisine" defaultValue={restaurant.cuisine} required /></label><label>Address<input name="address" defaultValue={restaurant.address} required /></label><label>Phone<input name="phone" defaultValue={restaurant.phone} /></label>
      <label>Opens<input name="openingTime" type="time" defaultValue={restaurant.openingTime} required /></label><label>Closes<input name="closingTime" type="time" defaultValue={restaurant.closingTime} required /></label><label>Time zone<input name="timeZone" defaultValue={restaurant.timeZone || 'Europe/London'} required /></label>
      <label className="wide-field">Description<textarea name="description" defaultValue={restaurant.description} maxLength="1500" rows="3" /></label><label className="wide-field">Replace image<input name="image" type="file" accept="image/jpeg,image/png,image/webp" /></label>
      {restaurant.imagePublicId && <label className="remove-image"><input name="removeImage" type="checkbox" value="true" /> Remove the current image</label>}
      <button className="dark-cta" disabled={busy}>Save details</button>
    </form>}
    <div className="table-manager-head"><h4>Tables <span>{restaurant.tables.length}</span></h4><button className="add-table-button" onClick={() => setNewTable(value => !value)}><Plus size={14} /> Add table</button></div>
    {newTable && <form className="table-edit-row" onSubmit={addTable}><label>Table name<input name="tableNumber" placeholder="Window 01" maxLength="40" required /></label><label>Seats<input name="capacity" type="number" min="1" max="30" placeholder="2" required /></label><button className="dark-cta" disabled={busy}>Add table</button></form>}
    {restaurant.tables.map(table => <form className="table-edit-row" key={table._id} onSubmit={event => saveTable(event, table)}><label>Table name<input name="tableNumber" defaultValue={table.tableNumber} maxLength="40" required /></label><label>Seats<input name="capacity" type="number" min="1" max="30" defaultValue={table.capacity} required /></label><label className="table-active"><input type="checkbox" name="isActive" defaultChecked={table.isActive} /> Active for bookings</label><button className="outline-button" disabled={busy}>Save</button></form>)}
  </article>;
}
