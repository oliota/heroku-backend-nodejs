import fs from "fs/promises";
import { db, FieldValue } from "../config/firebase.js";

const PRIMARY_EMPLOYEE = "Eliane Oliota";
const DEFAULT_COLOR = "#9aa0a6";
const codes = db.collection("pingo_schedule_codes");
const months = db.collection("pingo_schedule_months");
const settings = db.collection("pingo_schedule_settings").doc("default");
const normalizeCode = value => String(value ?? "").toUpperCase().trim().replace(/[^A-Z0-9]/g, "");
const monthPattern = /^20\d{2}-(0[1-9]|1[0-2])$/;
const daysInMonth = key => new Date(Number(key.slice(0, 4)), Number(key.slice(5, 7)), 0).getDate();
const snapshotData = snapshot => snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
const codeDefaults = code => ({ label: `Código ${code}`, start: "", end: "", breakStart: "", breakEnd: "", color: DEFAULT_COLOR });

function validateImport(payload) {
  if (!payload || typeof payload !== "object") throw new Error("Invalid JSON object");
  const month = String(payload.month ?? "").trim();
  if (!monthPattern.test(month)) throw new Error('Field "month" must use YYYY-MM');
  if (!payload.employees || typeof payload.employees !== "object" || Array.isArray(payload.employees)) throw new Error('Field "employees" is required');
  const maxDay = daysInMonth(month);
  const employees = {};
  for (const [rawName, rawValue] of Object.entries(payload.employees)) {
    let name = String(rawName).replace(/\s+/g, " ").trim();
    if (!name) throw new Error("Employee name is required");
    if (name.toLocaleLowerCase() === PRIMARY_EMPLOYEE.toLocaleLowerCase()) name = PRIMARY_EMPLOYEE;
    const rawDays = rawValue?.days && typeof rawValue.days === "object" ? rawValue.days : rawValue;
    if (!rawDays || typeof rawDays !== "object" || Array.isArray(rawDays)) throw new Error(`Invalid days for ${name}`);
    const days = {};
    for (const [rawDay, rawCode] of Object.entries(rawDays)) {
      const day = Number(rawDay);
      if (!Number.isInteger(day) || day < 1 || day > maxDay) throw new Error(`Invalid day ${rawDay} for ${month}`);
      const code = normalizeCode(rawCode);
      if (code) days[String(day)] = code;
    }
    employees[name] = { days };
  }
  if (!employees[PRIMARY_EMPLOYEE]) throw new Error(`${PRIMARY_EMPLOYEE} is required`);
  return { month, employees };
}

async function ensureCodes(employees) {
  const unique = [...new Set(Object.values(employees).flatMap(employee => Object.values(employee.days)))];
  await Promise.all(unique.map(async code => {
    const ref = codes.doc(code);
    if (!(await ref.get()).exists) await ref.set(codeDefaults(code));
  }));
}

export async function getSchedule(_req, res, next) {
  try {
    const [codeSnap, monthSnap, settingSnap] = await Promise.all([codes.get(), months.get(), settings.get()]);
    const codeMap = Object.fromEntries(codeSnap.docs.map(doc => [doc.id, doc.data()]));
    const monthMap = Object.fromEntries(monthSnap.docs.map(doc => [doc.id, doc.data()]));
    res.json({ employee: PRIMARY_EMPLOYEE, codes: codeMap, months: monthMap, ui: settingSnap.exists ? settingSnap.data().ui ?? {} : {} });
  } catch (error) { next(error); }
}

export async function listCodes(_req, res, next) {
  try { res.json(snapshotData(await codes.get())); } catch (error) { next(error); }
}

export async function createCode(req, res, next) {
  try {
    const code = normalizeCode(req.body.code);
    if (!code) return res.status(400).json({ error: "code is required" });
    const ref = codes.doc(code);
    if ((await ref.get()).exists) return res.status(409).json({ error: "code already exists" });
    const data = { ...codeDefaults(code), ...req.body };
    delete data.code;
    await ref.set(data);
    res.status(201).json({ id: code, ...data });
  } catch (error) { next(error); }
}

export async function updateCode(req, res, next) {
  try {
    const code = normalizeCode(req.params.code);
    const ref = codes.doc(code);
    if (!(await ref.get()).exists) return res.sendStatus(404);
    const data = { ...req.body };
    delete data.code;
    await ref.set(data, { merge: true });
    res.json({ id: code, ...(await ref.get()).data() });
  } catch (error) { next(error); }
}

export async function deleteCode(req, res, next) {
  try { await codes.doc(normalizeCode(req.params.code)).delete(); res.sendStatus(204); } catch (error) { next(error); }
}

export async function listMonths(_req, res, next) {
  try { res.json(snapshotData(await months.orderBy("month").get())); } catch (error) { next(error); }
}

export async function getMonth(req, res, next) {
  try {
    const doc = await months.doc(req.params.month).get();
    if (!doc.exists) return res.sendStatus(404);
    res.json({ id: doc.id, ...doc.data() });
  } catch (error) { next(error); }
}

export async function upsertMonth(req, res, next) {
  try {
    const payload = validateImport({ month: req.params.month, employees: req.body.employees ?? req.body });
    await ensureCodes(payload.employees);
    const data = { month: payload.month, source: req.body.source || "api", employees: payload.employees, manualChanges: req.body.manualChanges || {} };
    await months.doc(payload.month).set(data);
    res.json(data);
  } catch (error) { res.status(400).json({ error: error.message }); }
}

export async function deleteMonth(req, res, next) {
  try { await months.doc(req.params.month).delete(); res.sendStatus(204); } catch (error) { next(error); }
}

export async function setManualChange(req, res, next) {
  try {
    const ref = months.doc(req.params.month);
    const doc = await ref.get();
    if (!doc.exists) return res.sendStatus(404);
    const day = Number(req.params.day);
    if (!Number.isInteger(day) || day < 1 || day > daysInMonth(req.params.month)) return res.status(400).json({ error: "invalid day" });
    const change = req.body;
    if (!change || !["swap", "adjustment"].includes(change.type)) return res.status(400).json({ error: "type must be swap or adjustment" });
    if (change.type === "adjustment") {
      change.code = normalizeCode(change.code);
      if (!change.code) return res.status(400).json({ error: "code is required" });
      await ensureCodes({ temp: { days: { [day]: change.code } } });
    }
    await ref.update({ [`manualChanges.${day}`]: change });
    res.json(change);
  } catch (error) { next(error); }
}

export async function deleteManualChange(req, res, next) {
  try {
    await months.doc(req.params.month).update({ [`manualChanges.${req.params.day}`]: FieldValue.delete() });
    res.sendStatus(204);
  } catch (error) { next(error); }
}

export async function importMonth(req, res) {
  try {
    let payload = req.body;
    if (typeof req.body?.text === "string") payload = JSON.parse(req.body.text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, ""));
    const parsed = validateImport(payload);
    await ensureCodes(parsed.employees);
    const data = { month: parsed.month, source: "text-import", employees: parsed.employees, manualChanges: {} };
    await months.doc(parsed.month).set(data);
    res.status(201).json(data);
  } catch (error) { res.status(400).json({ error: error.message }); }
}

export function getImportPrompt(_req, res) {
  res.type("text/plain").send(`Analise a imagem de uma escala mensal que vou anexar e gere SOMENTE um JSON válido para importar no meu widget, sem markdown, explicações ou comentários.\n\nFormato obrigatório:\n{\n  "month": "AAAA-MM",\n  "employees": {\n    "${PRIMARY_EMPLOYEE}": {\n      "1": "CODIGO",\n      "2": "CODIGO"\n    },\n    "Nome da outra pessoa": {\n      "1": "CODIGO"\n    }\n  }\n}\n\nRegras:\n- Identifique mês e ano pela imagem.\n- Leia todas as pessoas/linhas visíveis, não apenas ${PRIMARY_EMPLOYEE}.\n- Use o nome completo exatamente como estiver legível.\n- Para cada pessoa, inclua somente os dias que possuem código/escala.\n- As chaves dos dias devem ser números de 1 até o último dia real do mês, escritos como strings.\n- Preserve os códigos exatamente pelo significado visual da célula, normalizados em maiúsculas e sem espaços extras.\n- Não invente valores ilegíveis. Se uma célula não puder ser identificada com segurança, omita aquele dia.\n- ${PRIMARY_EMPLOYEE} deve existir em employees.\n- Não inclua nomes amigáveis, horários, cores ou descrições dos códigos; isso já está cadastrado no widget.\n- Retorne exclusivamente o JSON.`);
}

export async function getUi(_req, res, next) {
  try { const doc = await settings.get(); res.json(doc.exists ? doc.data().ui ?? {} : {}); } catch (error) { next(error); }
}

export async function setUi(req, res, next) {
  try { await settings.set({ ui: req.body }, { merge: true }); res.json(req.body); } catch (error) { next(error); }
}

export async function bootstrap(req, res, next) {
  try {
    const seed = JSON.parse(await fs.readFile(new URL("../data/schedule-seed.json", import.meta.url), "utf8"));
    await Promise.all(Object.entries(seed.codes || {}).map(([code, data]) => codes.doc(code).set(data)));
    await Promise.all(Object.entries(seed.months || {}).map(([month, data]) => months.doc(month).set({ month, ...data })));
    await settings.set({ ui: seed.ui || {} }, { merge: true });
    res.status(201).json({ codes: Object.keys(seed.codes || {}).length, months: Object.keys(seed.months || {}).length });
  } catch (error) { next(error); }
}
