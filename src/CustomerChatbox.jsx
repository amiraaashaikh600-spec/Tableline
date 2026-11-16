import { useState } from 'react';
import { Link } from 'react-router-dom';
import { MessageCircle, Send, Sparkles, X } from 'lucide-react';
import { api, jsonBody } from './api.js';

export default function CustomerChatbox({ partySize = 2, cuisine = '', location = '' }) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([{ role: 'assistant', content: 'Tell me what kind of meal you have in mind. I can suggest places from Tableline’s listed restaurants.' }]);
  const [input, setInput] = useState('');
  const [size, setSize] = useState(partySize);
  const [area, setArea] = useState(location);
  const [food, setFood] = useState(cuisine);
  const [busy, setBusy] = useState(false);

  const send = async event => {
    event.preventDefault();
    const question = input.trim();
    if (!question || busy) return;
    const next = [...messages, { role: 'user', content: question }];
    setMessages(next);
    setInput('');
    setBusy(true);
    try {
      const result = await api('/assistant/recommend', {
        method: 'POST',
        body: jsonBody({ messages: next.slice(-8), cuisine: food, location: area, partySize: size, preference: question }),
      });
      setMessages(current => [...current, { role: 'assistant', content: result.message, restaurants: result.restaurants || [], mode: result.mode }]);
    } catch (error) {
      setMessages(current => [...current, { role: 'assistant', content: error.message, error: true }]);
    } finally { setBusy(false); }
  };

  return <>
    {open && <section className="chat-panel" aria-label="Tableline restaurant assistant">
      <header className="chat-head"><span className="chat-mark"><Sparkles size={16} /></span><div><strong>Ask Tableline</strong><small>Restaurant suggestions, from our listings</small></div><button onClick={() => setOpen(false)} aria-label="Close chat"><X size={17} /></button></header>
      <div className="chat-context">
        <label>Area<input value={area} onChange={event => setArea(event.target.value)} placeholder="Any neighbourhood" maxLength={100} /></label>
        <label>Cuisine<input value={food} onChange={event => setFood(event.target.value)} placeholder="Any cuisine" maxLength={60} /></label>
        <label>Guests<select value={size} onChange={event => setSize(Number(event.target.value))}>{Array.from({ length: 30 }, (_, index) => index + 1).map(count => <option key={count} value={count}>{count}</option>)}</select></label>
      </div>
      <div className="chat-messages" aria-live="polite">{messages.map((message, index) => <div className={`chat-message ${message.role}${message.error ? ' error' : ''}`} key={`${index}-${message.role}`}>{message.mode === 'demo' && <small className="demo-mode-label">Demo suggestions · not AI-generated</small>}<p>{message.content}</p>{message.restaurants?.length > 0 && <div className="chat-results">{message.restaurants.map(restaurant => <Link to={`/restaurants/${restaurant._id}`} key={restaurant._id} onClick={() => setOpen(false)}><strong>{restaurant.name}</strong><span>{restaurant.cuisine} · {restaurant.address}</span><small>View restaurant <span aria-hidden="true">→</span></small></Link>)}</div>}{message.role === 'assistant' && !message.error && message.restaurants?.length === 0 && index > 0 && <small className="chat-note">Suggestions only; booking is a separate step.</small>}</div>)}{busy && <div className="chat-message assistant"><p className="chat-typing">Finding places in the restaurant listings…</p></div>}</div>
      <form className="chat-compose" onSubmit={send}><input aria-label="Ask about restaurants" value={input} onChange={event => setInput(event.target.value)} maxLength={400} placeholder="Ask about a meal or occasion…" required /><button aria-label="Send message" disabled={busy || !input.trim()}><Send size={16} /></button></form>
      <small className="chat-disclaimer">Suggestions never create or confirm bookings.</small>
    </section>}
    <button className={`chat-launch ${open ? 'active' : ''}`} onClick={() => setOpen(value => !value)} aria-expanded={open} aria-label={open ? 'Close Tableline assistant' : 'Open Tableline assistant'}>{open ? <X size={21} /> : <><MessageCircle size={19} /><span>Ask Tableline</span></>}</button>
  </>;
}
