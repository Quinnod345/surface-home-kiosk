import EventKit
import Foundation

// Native Reminders worker for the Surface Home Kiosk. Two modes:
//   one-shot:  ./remind <cmd> [args...]            -> prints one JSON line
//   server:    pipe JSON lines on stdin {cmd,...}  -> one JSON line per request
// Commands: lists | items <list> | add <list> <title> | complete <id> |
//           uncomplete <id> | delete <id>
// EventKit sees iCloud shared lists natively, so add/check/delete all sync.

let store = EKEventStore()

func requestAccess() -> Bool {
  let sem = DispatchSemaphore(value: 0)
  var ok = false
  store.requestFullAccessToReminders { granted, _ in ok = granted; sem.signal() }
  sem.wait()
  return ok
}

func calendar(named title: String) -> EKCalendar? {
  store.calendars(for: .reminder).first { $0.title == title }
}

func fetchItems(_ cals: [EKCalendar]) -> [EKReminder] {
  let pred = store.predicateForReminders(in: cals)
  let sem = DispatchSemaphore(value: 0)
  var out: [EKReminder] = []
  store.fetchReminders(matching: pred) { rems in out = rems ?? []; sem.signal() }
  sem.wait()
  return out
}

// Only the open (incomplete) reminders — the actual shopping list. A long-lived
// shared grocery list can have thousands of completed items; we never ship those.
func fetchOpen(_ cals: [EKCalendar]) -> [EKReminder] {
  let pred = store.predicateForIncompleteReminders(
    withDueDateStarting: nil, ending: nil, calendars: cals)
  let sem = DispatchSemaphore(value: 0)
  var out: [EKReminder] = []
  store.fetchReminders(matching: pred) { rems in out = rems ?? []; sem.signal() }
  sem.wait()
  // Newest first (creationDate), so freshly added items surface at the top.
  return out.sorted { ($0.creationDate ?? .distantPast) > ($1.creationDate ?? .distantPast) }
}

func findReminder(_ id: String) -> EKReminder? {
  if let r = store.calendarItem(withIdentifier: id) as? EKReminder { return r }
  // Fallback: scan all reminder lists for the id.
  return fetchItems(store.calendars(for: .reminder)).first { $0.calendarItemIdentifier == id }
}

func reminderDict(_ r: EKReminder) -> [String: Any] {
  var d: [String: Any] = [
    "id": r.calendarItemIdentifier,
    "title": r.title ?? "",
    "completed": r.isCompleted,
    "list": r.calendar?.title ?? "",
  ]
  if let due = r.dueDateComponents?.date {
    d["due"] = ISO8601DateFormatter().string(from: due)
  }
  return d
}

func emit(_ obj: [String: Any]) {
  let data = (try? JSONSerialization.data(withJSONObject: obj)) ?? Data("{\"ok\":false}".utf8)
  FileHandle.standardOutput.write(data)
  FileHandle.standardOutput.write(Data("\n".utf8))
}

func handle(_ cmd: String, _ a: [String], _ obj: [String: Any]?) -> [String: Any] {
  func arg(_ i: Int, _ key: String) -> String {
    if a.count > i { return a[i] }
    return (obj?[key] as? String) ?? ""
  }
  switch cmd {
  case "lists":
    let cals = store.calendars(for: .reminder).map {
      ["id": $0.calendarIdentifier, "title": $0.title, "writable": $0.allowsContentModifications] as [String: Any]
    }
    return ["ok": true, "lists": cals]
  case "items":
    let name = arg(0, "list")
    guard let cal = calendar(named: name) else { return ["ok": false, "error": "list not found: \(name)"] }
    return ["ok": true, "items": fetchOpen([cal]).map(reminderDict)]
  case "add":
    let name = arg(0, "list"); let title = arg(1, "title")
    guard let cal = calendar(named: name) else { return ["ok": false, "error": "list not found: \(name)"] }
    let r = EKReminder(eventStore: store)
    r.title = title; r.calendar = cal
    do { try store.save(r, commit: true); return ["ok": true, "id": r.calendarItemIdentifier] }
    catch { return ["ok": false, "error": "\(error)"] }
  case "complete", "uncomplete":
    guard let r = findReminder(arg(0, "id")) else { return ["ok": false, "error": "reminder not found"] }
    r.isCompleted = (cmd == "complete")
    do { try store.save(r, commit: true); return ["ok": true] } catch { return ["ok": false, "error": "\(error)"] }
  case "delete":
    guard let r = findReminder(arg(0, "id")) else { return ["ok": false, "error": "reminder not found"] }
    do { try store.remove(r, commit: true); return ["ok": true] } catch { return ["ok": false, "error": "\(error)"] }
  default:
    return ["ok": false, "error": "unknown cmd: \(cmd)"]
  }
}

guard requestAccess() else { emit(["ok": false, "error": "reminders access denied"]); exit(1) }

let argv = Array(CommandLine.arguments.dropFirst())
if !argv.isEmpty {
  emit(handle(argv[0], Array(argv.dropFirst()), nil))
  exit(0)
}

// server mode: one JSON request per stdin line, one JSON response per line
while let line = readLine(strippingNewline: true) {
  if line.isEmpty { continue }
  guard let data = line.data(using: .utf8),
        let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
        let cmd = obj["cmd"] as? String else {
    emit(["ok": false, "error": "bad request"]); continue
  }
  var res = handle(cmd, [], obj)
  if let rid = obj["rid"] { res["rid"] = rid }
  emit(res)
}
