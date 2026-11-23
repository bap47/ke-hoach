// Lịch tự động cho "Kế hoạch" — trả về file .ics để Lịch Apple / Google Calendar đăng ký
import { createClient } from "jsr:@supabase/supabase-js@2";

const TZ_OFF = 7; // Asia/Ho_Chi_Minh
const pad = (n: number) => String(n).padStart(2, "0");
const esc = (s: string) => String(s || "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
function utc(local: string) { // 'YYYY-MM-DDTHH:MM' giờ VN -> 'YYYYMMDDTHHMMSSZ'
  const [d, t] = local.split("T"); const [y, m, dd] = d.split("-").map(Number); const [hh, mm] = (t || "09:00").split(":").map(Number);
  const x = new Date(Date.UTC(y, m - 1, dd, hh - TZ_OFF, mm));
  return x.getUTCFullYear() + pad(x.getUTCMonth() + 1) + pad(x.getUTCDate()) + "T" + pad(x.getUTCHours()) + pad(x.getUTCMinutes()) + "00Z";
}
const WD: Record<string, string> = { "0": "SU", "1": "MO", "2": "TU", "3": "WE", "4": "TH", "5": "FR", "6": "SA" };
function rrule(rep: string) {
  if (!rep || rep === "none") return "";
  if (rep.startsWith("days:")) return "RRULE:FREQ=WEEKLY;BYDAY=" + rep.slice(5).split(",").filter(Boolean).map((d) => WD[d]).join(",");
  return "RRULE:FREQ=" + ({ daily: "DAILY", weekly: "WEEKLY", monthly: "MONTHLY" } as Record<string, string>)[rep];
}
function fold(line: string) { const out: string[] = []; let s = line; while (new TextEncoder().encode(s).length > 73) { let i = 70; while (new TextEncoder().encode(s.slice(0, i)).length > 73) i--; out.push(s.slice(0, i)); s = " " + s.slice(i); } out.push(s); return out.join("\r\n"); }

Deno.serve(async (req) => {
  const tk = new URL(req.url).searchParams.get("t") || "";
  if (tk.length < 20) return new Response("Thiếu mã lịch", { status: 400 });
  let key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!key) { try { const o = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}"); key = (Object.values(o)[0] as string) || ""; } catch (_) { /* */ } }
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, key);
  const { data, error } = await sb.from("boards").select("data").eq("data->settings->>calToken", tk).limit(1);
  if (error) return new Response("Lỗi: " + error.message + " | key:" + (key ? key.slice(0, 8) : "none"), { status: 500 });
  if (!data || !data.length) return new Response("Không tìm thấy lịch | key:" + (key ? key.slice(0, 8) : "none"), { status: 404 });
  const S = data[0].data || {};
  const cats: Record<string, string> = {}; (S.cats || []).forEach((c: any) => cats[c.id] = c.name);
  const now = new Date(), stamp = utc(new Date(now.getTime() + TZ_OFF * 36e5).toISOString().slice(0, 16));
  const L: string[] = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//KeHoach//VI", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    "X-WR-CALNAME:" + esc((S.settings && S.settings.title) || "Kế hoạch"), "X-WR-TIMEZONE:Asia/Ho_Chi_Minh", "REFRESH-INTERVAL;VALUE=DURATION:PT15M", "X-PUBLISHED-TTL:PT15M"];
  const ev = (o: Record<string, string>, rr: string, alarm?: number) => {
    L.push("BEGIN:VEVENT"); for (const k in o) if (o[k]) L.push(fold(k + ":" + o[k])); if (rr) L.push(rr);
    if (alarm != null && alarm >= 0) L.push("BEGIN:VALARM", "ACTION:DISPLAY", "DESCRIPTION:" + (o.SUMMARY || "Nhắc việc"), "TRIGGER:-PT" + alarm + "M", "END:VALARM");
    L.push("END:VEVENT");
  };
  // Việc
  (S.tasks || []).forEach((t: any) => {
    if (!t.due || t.status === "done" || t.status === "cancel") return;
    const due = t.due.length > 10 ? t.due.slice(0, 16) : t.due + "T09:00";
    const endL = new Date(new Date(due + ":00Z").getTime() + 30 * 6e4).toISOString().slice(0, 16);
    ev({ UID: "task-" + t.id + "@kehoach", DTSTAMP: stamp, DTSTART: utc(due), DTEND: utc(endL), SUMMARY: esc(t.title || "Việc"),
      DESCRIPTION: esc([(cats[t.cat] || ""), t.note || "", ...(t.links || [])].filter(Boolean).join("\n")) }, rrule(t.repeat), Number(t.remind ?? 30));
  });
  // Lịch học
  ((S.recs && S.recs.courses) || []).forEach((c: any) => {
    if (!c.days || !c.days.length || !c.tstart) return;
    const first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const startD = c.start ? new Date(c.start + "T00:00:00Z") : first;
    let d = new Date(startD); for (let i = 0; i < 7 && !c.days.includes(String(d.getUTCDay())); i++) d.setUTCDate(d.getUTCDate() + 1);
    const day = d.toISOString().slice(0, 10);
    let rr = "RRULE:FREQ=WEEKLY;BYDAY=" + c.days.map((x: string) => WD[x]).join(",");
    if (c.end) rr += ";UNTIL=" + c.end.replace(/-/g, "") + "T235959Z";
    ev({ UID: "course-" + c.id + "@kehoach", DTSTAMP: stamp, DTSTART: utc(day + "T" + c.tstart), DTEND: utc(day + "T" + (c.tend || c.tstart)), SUMMARY: esc("📚 " + (c.name || "Môn học")), LOCATION: esc(c.place || "") }, rr, 15);
  });
  L.push("END:VCALENDAR");
  return new Response(L.join("\r\n") + "\r\n", { headers: { "Content-Type": "text/calendar; charset=utf-8", "Cache-Control": "no-cache" } });
});
