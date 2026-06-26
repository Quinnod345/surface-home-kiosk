import { useCallback, useEffect, useState } from "react";
import { Check, Plus, ShoppingCart } from "lucide-react";
import type { KioskConfig } from "./config";

// Normalized item used by the view, independent of backend.
type Item = { id: string; title: string; completed: boolean };

type CallService = (
  domain: string,
  service: string,
  payload: Record<string, unknown>,
) => Promise<void>;

// The grocery / reminders view. Two backends:
//   • Native Apple Reminders via the Mac "reminders bridge" (window.surfaceKiosk
//     .reminders*) — used when config.grocery.bridgeUrl is set. This is the only
//     way to read AND add to an iCloud *shared* list. It returns OPEN items only.
//   • A Home Assistant todo entity (listTodo + todo.* services) — the fallback.
export function GroceryView({
  config,
  onCallService,
}: {
  config: KioskConfig;
  onCallService: CallService;
}) {
  const sk = window.surfaceKiosk;
  const useBridge = !!config.grocery?.bridgeUrl && !!sk?.remindersItems;
  const entityId = config.grocery?.entityId;

  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newText, setNewText] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (useBridge) {
        const r = await sk!.remindersItems!();
        if (!r?.ok) throw new Error(r?.error || "bridge error");
        setItems((r.items ?? []).map((i) => ({ id: i.id, title: i.title, completed: i.completed })));
      } else {
        if (!entityId || !sk?.listTodo) return;
        const r = await sk.listTodo(entityId);
        const list = Array.isArray(r?.items) ? r.items : [];
        const mapped: Item[] = list.map((t) => ({
          id: t.uid,
          title: t.summary,
          completed: t.status === "completed",
        }));
        mapped.sort((a, b) => (a.completed === b.completed ? 0 : a.completed ? 1 : -1));
        setItems(mapped);
      }
    } catch {
      setError(
        useBridge
          ? "Couldn't reach the reminders bridge. Check the Mac service in Settings."
          : "Couldn't load this list. Check the entity in Settings.",
      );
    } finally {
      setLoading(false);
    }
  }, [useBridge, entityId, sk]);

  useEffect(() => {
    void refresh();
    const id = window.setInterval(() => void refresh(), 30000);
    return () => window.clearInterval(id);
  }, [refresh]);

  const toggle = async (item: Item) => {
    if (useBridge) {
      // The bridge shows open items only; checking one off removes it from view.
      setItems((prev) => prev.filter((i) => i.id !== item.id));
      try {
        await sk!.remindersComplete!(item.id);
      } finally {
        window.setTimeout(() => void refresh(), 500);
      }
      return;
    }
    const next = !item.completed;
    setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, completed: next } : i)));
    await onCallService("todo", "update_item", {
      entity_id: entityId,
      item: item.id,
      status: next ? "completed" : "needs_action",
    });
    window.setTimeout(() => void refresh(), 600);
  };

  const add = async () => {
    const text = newText.trim();
    if (!text) return;
    setNewText("");
    setBusy(true);
    try {
      if (useBridge) {
        await sk!.remindersAdd!(text);
      } else {
        if (!entityId) return;
        await onCallService("todo", "add_item", { entity_id: entityId, item: text });
      }
      window.setTimeout(() => void refresh(), 500);
    } finally {
      setBusy(false);
    }
  };

  const clearCompleted = async () => {
    if (useBridge || !entityId) return;
    await onCallService("todo", "remove_completed_items", { entity_id: entityId });
    window.setTimeout(() => void refresh(), 600);
  };

  if (!useBridge && !sk?.listTodo) {
    return (
      <div className="grocery-view">
        <div className="grocery-empty">The grocery list is available on the kiosk device.</div>
      </div>
    );
  }
  if (!useBridge && !entityId) {
    return (
      <div className="grocery-view">
        <div className="grocery-empty">
          <ShoppingCart size={26} />
          <span>No list selected yet. Pick a list (or set up the Reminders bridge) in Settings.</span>
        </div>
      </div>
    );
  }

  const active = items.filter((i) => !i.completed);
  const done = items.filter((i) => i.completed);

  return (
    <div className="grocery-view">
      <div className="grocery-add">
        <input
          type="text"
          value={newText}
          placeholder="Add an item…"
          onChange={(event) => setNewText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void add();
          }}
        />
        <button
          type="button"
          className="grocery-add-btn"
          disabled={busy || !newText.trim()}
          onClick={() => void add()}
        >
          <Plus size={18} />
          <span>Add</span>
        </button>
      </div>

      {error ? <p className="grocery-error">{error}</p> : null}

      <div className="grocery-list">
        {active.map((item, index) => (
          <button
            type="button"
            key={item.id}
            className="grocery-row"
            style={{ ["--i" as string]: index }}
            onClick={() => void toggle(item)}
          >
            <span className="grocery-check" />
            <span className="grocery-text">{item.title}</span>
          </button>
        ))}

        {!active.length && !loading ? (
          <div className="grocery-empty">Nothing on the list — add something above.</div>
        ) : null}

        {done.length ? (
          <div className="grocery-done">
            <div className="grocery-done-head">
              <span>{done.length} done</span>
              <button type="button" onClick={() => void clearCompleted()}>
                Clear
              </button>
            </div>
            {done.map((item) => (
              <button
                type="button"
                key={item.id}
                className="grocery-row done"
                onClick={() => void toggle(item)}
              >
                <span className="grocery-check checked">
                  <Check size={13} />
                </span>
                <span className="grocery-text">{item.title}</span>
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
