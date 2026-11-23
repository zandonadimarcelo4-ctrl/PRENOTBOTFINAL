import tls from "node:tls";
import { EnvMap } from "./core.ts";

export interface OtpRecord {
  code: string;
  from: string;
  subject: string;
  receivedAt: string;
  source: "imap" | "webmail" | "manual";
  capturedAtMs: number;
}

export interface OtpFetchResult {
  ok: boolean;
  otp: OtpRecord | null;
  checkedImap: boolean;
  imapConfigured: boolean;
  host?: string;
  matchedCount?: number;
  error?: string;
}

export const PRENOTAMI_OTP_SENDER = "noreply-prenotami@esteri.it";

let latestOtp: OtpRecord | null = null;
let lastImapAttemptMs = 0;
let lastImapResult: OtpFetchResult | null = null;

function stripUnsafeHeaderChars(s: unknown, maxLen = 180): string {
  return String(s ?? "")
    .replace(/[\r\n\0]+/g, " ")
    .trim()
    .slice(0, maxLen);
}

export function isValidOtpCode(raw: unknown): string | null {
  const clean = String(raw ?? "").trim();
  if (/^\d{4,8}$/.test(clean)) return clean;
  return null;
}

export function decodeEmailBody(raw: string): string {
  return String(raw ?? "")
    .replace(/=\r?\n/g, "")
    .replace(/=([0-9A-Fa-f]{2})/g, (_m, hex) => {
      const n = parseInt(hex, 16);
      return Number.isFinite(n) && n >= 32 && n <= 126 ? String.fromCharCode(n) : " ";
    })
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&#(\d+);/g, (_m, dec) => String.fromCharCode(Number(dec) || 32))
    .replace(/\s+/g, " ")
    .trim();
}

export function extractOtpFromEmailText(
  subject: string,
  body: string,
  from = ""
): string | null {
  const fromLower = String(from ?? "").toLowerCase();
  const cleanSubject = decodeEmailBody(subject);
  const cleanBody = decodeEmailBody(body);
  const combined = `${cleanSubject} ${cleanBody}`.trim();
  const combinedLower = combined.toLowerCase();

  const looksLikePrenotami =
    fromLower.includes("prenotami") ||
    fromLower.includes("esteri.it") ||
    combinedLower.includes("prenotami") ||
    combinedLower.includes("esteri.it") ||
    combinedLower.includes("otp") ||
    combinedLower.includes("codice");

  if (!looksLikePrenotami) return null;

  const explicitPatterns = [
    /(?:codigo\s*otp|codice\s*otp|otp|codice\s*(?:di\s*)?verifica|codice\s*temporaneo|verification\s*code|security\s*code|pin\s*(?:code)?|codice)[^\d]{0,45}(\b\d{4,8}\b)/i,
    /(\b\d{4,8}\b)[^\w]{1,25}(?:e\s*il\s*tuo\s*codice|is\s*your\s*(?:otp|code)|codigo|codice)/i,
  ];

  for (const rx of explicitPatterns) {
    const m = combined.match(rx);
    if (m && m[1]) {
      return m[1];
    }
  }

  if (fromLower.includes("noreply-prenotami@esteri.it") || fromLower.includes("prenotami")) {
    const candidates = combined.match(/\b\d{5,8}\b/g) ?? [];
    for (const c of candidates) {
      const n = Number(c);
      if (c.length === 4 && n >= 1990 && n <= 2040) continue;
      if (c === "05402" || c === "05256") continue;
      return c;
    }
  }

  return null;
}

export function reportCapturedOtp(input: {
  code: unknown;
  from?: unknown;
  subject?: unknown;
  receivedAt?: unknown;
  source?: "imap" | "webmail" | "manual";
}): OtpRecord | null {
  const code = isValidOtpCode(input.code);
  if (!code) return null;

  const rec: OtpRecord = {
    code,
    from: stripUnsafeHeaderChars(input.from || PRENOTAMI_OTP_SENDER, 120),
    subject: stripUnsafeHeaderChars(input.subject || "Código OTP Prenot@mi", 160),
    receivedAt: stripUnsafeHeaderChars(
      input.receivedAt || new Date().toLocaleTimeString("pt-BR", { hour12: false }),
      60
    ),
    source: input.source ?? "webmail",
    capturedAtMs: Date.now(),
  };
  latestOtp = rec;
  return rec;
}

export function getCachedOtp(): (OtpRecord & { isFresh: boolean }) | null {
  if (!latestOtp) return null;
  return {
    ...latestOtp,
    isFresh: Date.now() - latestOtp.capturedAtMs <= 15 * 60_000,
  };
}

export function isSafePublicHost(rawHost: string): boolean {
  const host = String(rawHost ?? "").trim().toLowerCase();
  if (!host || !/^[a-z0-9.-]{3,120}$/.test(host) || !host.includes(".")) {
    return false;
  }
  if (
    host === "localhost" ||
    host.endsWith(".local") ||
    host.startsWith("127.") ||
    host.startsWith("10.") ||
    host.startsWith("192.168.") ||
    host.startsWith("169.254.") ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(host)
  ) {
    return false;
  }
  return true;
}

export function inferImapHost(email: string, explicitHost?: string): string | null {
  const explicit = String(explicitHost ?? "").trim().toLowerCase();
  if (explicit) {
    return isSafePublicHost(explicit) ? explicit : null;
  }
  const at = String(email ?? "").trim().toLowerCase().split("@")[1] ?? "";
  if (!at) return null;
  if (at === "gmail.com" || at === "googlemail.com") return "imap.gmail.com";
  if (
    at === "outlook.com" ||
    at === "hotmail.com" ||
    at === "live.com" ||
    at === "msn.com"
  ) {
    return "outlook.office365.com";
  }
  if (at.startsWith("yahoo.")) return "imap.mail.yahoo.com";
  if (at === "icloud.com" || at === "me.com" || at === "mac.com") {
    return "imap.mail.me.com";
  }
  if (at === "uol.com.br") return "imap.uol.com.br";
  if (at === "terra.com.br") return "imap.terra.com.br";
  if (at === "bol.com.br") return "imap.bol.com.br";

  const candidate = `imap.${at}`;
  return isSafePublicHost(candidate) ? candidate : null;
}

function escapeImapQuoted(val: string): string {
  return String(val ?? "")
    .replace(/[\r\n\0]/g, "")
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"');
}

class ImapMiniClient {
  private socket: tls.TLSSocket;
  private buffer = "";
  private tagCounter = 0;

  constructor(host: string, port = 993) {
    this.socket = tls.connect({
      host,
      port,
      servername: host,
      rejectUnauthorized: true,
    });
    this.socket.setTimeout(10000);
    this.socket.setEncoding("utf-8");
  }

  async waitReady(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const onData = (chunk: string) => {
        this.buffer += chunk;
        const nl = this.buffer.indexOf("\r\n");
        if (nl !== -1) {
          const line = this.buffer.slice(0, nl);
          this.buffer = this.buffer.slice(nl + 2);
          cleanup();
          if (line.startsWith("* OK") || line.startsWith("* PREAUTH")) {
            resolve();
          } else {
            reject(new Error(`IMAP greeting inesperado: ${line.slice(0, 80)}`));
          }
        }
      };
      const onErr = (e: Error) => {
        cleanup();
        reject(e);
      };
      const onTimeout = () => {
        cleanup();
        reject(new Error("Tempo esgotado ao conectar no servidor IMAP."));
      };
      const cleanup = () => {
        this.socket.off("data", onData);
        this.socket.off("error", onErr);
        this.socket.off("timeout", onTimeout);
      };
      this.socket.on("data", onData);
      this.socket.on("error", onErr);
      this.socket.on("timeout", onTimeout);
    });
  }

  async command(cmd: string): Promise<{ status: string; lines: string[]; raw: string }> {
    const tag = `A${String(++this.tagCounter).padStart(3, "0")}`;
    return new Promise((resolve, reject) => {
      let acc = this.buffer;
      this.buffer = "";

      const finishIfTagged = () => {
        const tagRx = new RegExp(`(?:^|\\r\\n)${tag} (OK|NO|BAD)[^\\r\\n]*\\r\\n`);
        const match = acc.match(tagRx);
        if (!match) return false;

        const endIdx = (match.index ?? 0) + match[0].length;
        const consumed = acc.slice(0, endIdx);
        this.buffer = acc.slice(endIdx);
        cleanup();
        const lines = consumed.split("\r\n").filter(Boolean);
        resolve({
          status: match[1],
          lines,
          raw: consumed,
        });
        return true;
      };

      const onData = (chunk: string) => {
        acc += chunk;
        finishIfTagged();
      };
      const onErr = (e: Error) => {
        cleanup();
        reject(e);
      };
      const onTimeout = () => {
        cleanup();
        reject(new Error(`Timeout IMAP no comando ${tag}`));
      };
      const cleanup = () => {
        this.socket.off("data", onData);
        this.socket.off("error", onErr);
        this.socket.off("timeout", onTimeout);
      };

      if (!finishIfTagged()) {
        this.socket.on("data", onData);
        this.socket.on("error", onErr);
        this.socket.on("timeout", onTimeout);
        this.socket.write(`${tag} ${cmd}\r\n`);
      }
    });
  }

  close(): void {
    try {
      this.socket.end();
      this.socket.destroy();
    } catch {
      // ignore
    }
  }
}

export async function fetchLatestPrenotamiOtpViaImap(
  env: Partial<EnvMap>,
  force = false
): Promise<OtpFetchResult> {
  const email = (env.IMAP_EMAIL || env.PRENOTAMI_EMAIL || "").trim();
  const appPass = (env.IMAP_SENHA_APP || "").trim();
  const host = inferImapHost(email, env.IMAP_SERVIDOR);

  if (!email || !appPass) {
    return {
      ok: false,
      otp: getCachedOtp(),
      checkedImap: false,
      imapConfigured: false,
      error:
        "IMAP não configurado (informe IMAP_EMAIL e IMAP_SENHA_APP na aba Avisos para leitura automática em segundo plano, ou deixe o Webmail aberto no Chromium).",
    };
  }

  if (!host) {
    return {
      ok: false,
      otp: getCachedOtp(),
      checkedImap: false,
      imapConfigured: false,
      error: "Servidor IMAP inválido ou privado bloqueado.",
    };
  }

  const now = Date.now();
  if (!force && lastImapResult && now - lastImapAttemptMs < 12_000) {
    return {
      ...lastImapResult,
      otp: getCachedOtp() ?? lastImapResult.otp,
    };
  }
  lastImapAttemptMs = now;

  const client = new ImapMiniClient(host, 993);
  try {
    await client.waitReady();
    const loginRes = await client.command(
      `LOGIN "${escapeImapQuoted(email)}" "${escapeImapQuoted(appPass)}"`
    );
    if (loginRes.status !== "OK") {
      const res: OtpFetchResult = {
        ok: false,
        otp: getCachedOtp(),
        checkedImap: true,
        imapConfigured: true,
        host,
        error: "Falha no login IMAP (verifique e-mail e Senha de App).",
      };
      lastImapResult = res;
      return res;
    }

    const sel = await client.command(`SELECT "INBOX"`);
    if (sel.status !== "OK") {
      const res: OtpFetchResult = {
        ok: false,
        otp: getCachedOtp(),
        checkedImap: true,
        imapConfigured: true,
        host,
        error: "Não foi possível abrir a caixa de entrada (INBOX).",
      };
      lastImapResult = res;
      return res;
    }

    let ids: number[] = [];
    const searchExact = await client.command(
      `SEARCH FROM "${PRENOTAMI_OTP_SENDER}"`
    );
    for (const line of searchExact.lines) {
      if (line.startsWith("* SEARCH")) {
        ids = line
          .replace("* SEARCH", "")
          .trim()
          .split(/\s+/)
          .filter((x) => /^\d+$/.test(x))
          .map(Number);
      }
    }

    if (ids.length === 0) {
      const searchBroad = await client.command(`SEARCH FROM "prenotami"`);
      for (const line of searchBroad.lines) {
        if (line.startsWith("* SEARCH")) {
          ids = line
            .replace("* SEARCH", "")
            .trim()
            .split(/\s+/)
            .filter((x) => /^\d+$/.test(x))
            .map(Number);
        }
      }
    }

    if (ids.length === 0) {
      await client.command("LOGOUT").catch(() => {});
      const res: OtpFetchResult = {
        ok: true,
        otp: getCachedOtp(),
        checkedImap: true,
        imapConfigured: true,
        host,
        matchedCount: 0,
      };
      lastImapResult = res;
      return res;
    }

    const recentIds = ids.slice(-3).reverse();
    for (const msgId of recentIds) {
      const fetchRes = await client.command(
        `FETCH ${msgId} (BODY.PEEK[HEADER.FIELDS (FROM SUBJECT DATE)] BODY.PEEK[TEXT]<0.16384>)`
      );
      const subjMatch = fetchRes.raw.match(/Subject:\s*([^\r\n]+)/i);
      const fromMatch = fetchRes.raw.match(/From:\s*([^\r\n]+)/i);
      const dateMatch = fetchRes.raw.match(/Date:\s*([^\r\n]+)/i);
      const subject = subjMatch ? subjMatch[1].trim() : "";
      const from = fromMatch ? fromMatch[1].trim() : PRENOTAMI_OTP_SENDER;
      const receivedAt = dateMatch ? dateMatch[1].trim() : new Date().toISOString();

      const code = extractOtpFromEmailText(subject, fetchRes.raw, from);
      if (code) {
        const rec = reportCapturedOtp({
          code,
          from,
          subject,
          receivedAt,
          source: "imap",
        });
        await client.command("LOGOUT").catch(() => {});
        const res: OtpFetchResult = {
          ok: true,
          otp: rec,
          checkedImap: true,
          imapConfigured: true,
          host,
          matchedCount: ids.length,
        };
        lastImapResult = res;
        return res;
      }
    }

    await client.command("LOGOUT").catch(() => {});
    const res: OtpFetchResult = {
      ok: true,
      otp: getCachedOtp(),
      checkedImap: true,
      imapConfigured: true,
      host,
      matchedCount: ids.length,
    };
    lastImapResult = res;
    return res;
  } catch (e) {
    const res: OtpFetchResult = {
      ok: false,
      otp: getCachedOtp(),
      checkedImap: true,
      imapConfigured: true,
      host,
      error: e instanceof Error ? e.message : String(e),
    };
    lastImapResult = res;
    return res;
  } finally {
    client.close();
  }
}
