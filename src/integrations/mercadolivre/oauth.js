import crypto from "node:crypto";
import pool from "../../db/pool.js";

const AUTH_BASE_URL = "https://auth.mercadolivre.com.br/authorization";
const TOKEN_URL = "https://api.mercadolibre.com/oauth/token";
const STATE_TTL_MINUTES = 10;
const TOKEN_REFRESH_SKEW_MS = 2 * 60 * 1000;

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Variável ${name} não configurada.`);
  return value;
}

function hash(value) {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

function base64Url(buffer) {
  return buffer.toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

function getEncryptionKey() {
  const raw = process.env.MELI_OAUTH_ENCRYPTION_KEY?.trim();
  if (!raw) {
    throw new Error("MELI_OAUTH_ENCRYPTION_KEY não configurada.");
  }

  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    return Buffer.from(raw, "hex");
  }

  const decoded = Buffer.from(raw, "base64");
  if (decoded.length === 32) return decoded;

  throw new Error("MELI_OAUTH_ENCRYPTION_KEY deve ter 32 bytes (64 hex ou Base64 de 32 bytes).");
}

function encryptSecret(value) {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(String(value), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [base64Url(iv), base64Url(tag), base64Url(encrypted)].join(".");
}

function decryptSecret(payload) {
  if (!payload) return null;
  const key = getEncryptionKey();
  const [ivPart, tagPart, encryptedPart] = String(payload).split(".");
  if (!ivPart || !tagPart || !encryptedPart) {
    throw new Error("Credencial cifrada inválida.");
  }

  const iv = Buffer.from(ivPart, "base64url");
  const tag = Buffer.from(tagPart, "base64url");
  const encrypted = Buffer.from(encryptedPart, "base64url");

  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);

  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}

function getRedirectUri() {
  return requiredEnv("MELI_REDIRECT_URI").replace(/\/$/, "");
}

function usePkce() {
  return String(process.env.MELI_USE_PKCE ?? "false").toLowerCase() === "true";
}

export function buildMercadoLivreAuthorizationUrl(state, codeChallenge) {
  const url = new URL(AUTH_BASE_URL);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", requiredEnv("MELI_CLIENT_ID"));
  url.searchParams.set("redirect_uri", getRedirectUri());
  url.searchParams.set("state", state);

  if (usePkce()) {
    if (!codeChallenge) throw new Error("CODE_CHALLENGE ausente para PKCE.");
    url.searchParams.set("code_challenge", codeChallenge);
    url.searchParams.set("code_challenge_method", "S256");
  }

  return url.toString();
}

async function getMercadoLivrePlatformId(client = pool) {
  const result = await client.query(
    "SELECT id FROM affiliate_platforms WHERE code = 'mercadolivre' AND is_active = TRUE LIMIT 1"
  );
  const id = result.rows[0]?.id;
  if (!id) throw new Error("Plataforma Mercado Livre não está cadastrada/ativa.");
  return id;
}

export async function createMercadoLivreOAuthState() {
  const state = base64Url(crypto.randomBytes(32));
  const codeVerifier = usePkce() ? base64Url(crypto.randomBytes(32)) : null;
  const codeChallenge = codeVerifier
    ? base64Url(crypto.createHash("sha256").update(codeVerifier).digest())
    : null;

  await pool.query(
    `INSERT INTO mercadolivre_oauth_states
       (state_hash, code_verifier_encrypted, expires_at)
     VALUES ($1, $2, now() + ($3::text || ' minutes')::interval)`,
    [
      hash(state),
      codeVerifier ? encryptSecret(codeVerifier) : null,
      STATE_TTL_MINUTES
    ]
  );

  return { state, codeChallenge };
}

async function consumeOAuthState(state) {
  const result = await pool.query(
    `SELECT id, code_verifier_encrypted
       FROM mercadolivre_oauth_states
      WHERE state_hash = $1
        AND expires_at > now()
        AND used_at IS NULL
      LIMIT 1`,
    [hash(state)]
  );

  const row = result.rows[0];
  if (!row) throw new Error("State OAuth inválido, expirado ou já utilizado.");

  return {
    id: row.id,
    codeVerifier: row.code_verifier_encrypted
      ? decryptSecret(row.code_verifier_encrypted)
      : null
  };
}

async function exchangeAuthorizationCode(code, codeVerifier) {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: requiredEnv("MELI_CLIENT_ID"),
    client_secret: requiredEnv("MELI_CLIENT_SECRET"),
    code: String(code),
    redirect_uri: getRedirectUri()
  });

  if (usePkce()) {
    body.set("code_verifier", String(codeVerifier || ""));
  }

  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/x-www-form-urlencoded"
    },
    body
  });

  const raw = await response.text();
  let payload = {};
  try {
    payload = raw ? JSON.parse(raw) : {};
  } catch {
    payload = { message: raw.slice(0, 500) };
  }

  if (!response.ok) {
    throw new Error(
      `Mercado Livre OAuth/token respondeu ${response.status}: ${payload.message || raw.slice(0, 300)}`
    );
  }

  if (!payload.access_token || !payload.refresh_token || !payload.user_id) {
    throw new Error("Resposta OAuth do Mercado Livre sem access_token, refresh_token ou user_id.");
  }

  return payload;
}

async function exchangeRefreshToken(refreshToken) {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: requiredEnv("MELI_CLIENT_ID"),
    client_secret: requiredEnv("MELI_CLIENT_SECRET"),
    refresh_token: String(refreshToken)
  });

  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/x-www-form-urlencoded"
    },
    body
  });

  const raw = await response.text();
  let payload = {};
  try {
    payload = raw ? JSON.parse(raw) : {};
  } catch {
    payload = { message: raw.slice(0, 500) };
  }

  if (!response.ok) {
    throw new Error(
      `Mercado Livre refresh/token respondeu ${response.status}: ${payload.message || raw.slice(0, 300)}`
    );
  }

  if (!payload.access_token || !payload.refresh_token || !payload.user_id) {
    throw new Error("Resposta de refresh do Mercado Livre sem os tokens esperados.");
  }

  return payload;
}

async function upsertConnection(tokenPayload, client = pool) {
  const platformId = await getMercadoLivrePlatformId(client);
  const expiresAt = new Date(Date.now() + Number(tokenPayload.expires_in || 21600) * 1000);

  const result = await client.query(
    `INSERT INTO integration_connections (
        platform_id,
        account_label,
        auth_type,
        credential_ref,
        status,
        last_sync_at,
        account_user_id,
        access_token_encrypted,
        refresh_token_encrypted,
        access_token_expires_at,
        granted_scope,
        metadata,
        updated_at
      )
      VALUES (
        $1, $2, 'oauth2',
        'mercadolivre:primary',
        'authorized',
        now(),
        $3,
        $4,
        $5,
        $6,
        $7,
        $8::jsonb,
        now()
      )
      ON CONFLICT (platform_id, account_user_id)
      DO UPDATE SET
        account_label = EXCLUDED.account_label,
        status = 'authorized',
        last_sync_at = now(),
        access_token_encrypted = EXCLUDED.access_token_encrypted,
        refresh_token_encrypted = EXCLUDED.refresh_token_encrypted,
        access_token_expires_at = EXCLUDED.access_token_expires_at,
        granted_scope = EXCLUDED.granted_scope,
        metadata = EXCLUDED.metadata,
        updated_at = now()
      RETURNING id`,
    [
      platformId,
      `Mercado Livre ${tokenPayload.user_id}`,
      String(tokenPayload.user_id),
      encryptSecret(tokenPayload.access_token),
      encryptSecret(tokenPayload.refresh_token),
      expiresAt,
      tokenPayload.scope || null,
      JSON.stringify({
        tokenType: tokenPayload.token_type || "bearer",
        updatedBy: "oauth"
      })
    ]
  );

  return result.rows[0].id;
}

export async function completeMercadoLivreOAuth({ code, state, error, errorDescription }) {
  if (error) {
    throw new Error(
      `Mercado Livre recusou a autorização: ${errorDescription || error}`
    );
  }

  if (!code || !state) {
    throw new Error("Callback OAuth sem code ou state.");
  }

  const stateData = await consumeOAuthState(state);
  const tokenPayload = await exchangeAuthorizationCode(code, stateData.codeVerifier);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const connectionId = await upsertConnection(tokenPayload, client);

    await client.query(
      `UPDATE mercadolivre_oauth_states
          SET used_at = now()
        WHERE id = $1`,
      [stateData.id]
    );

    await client.query(
      `DELETE FROM mercadolivre_oauth_states
        WHERE expires_at <= now() OR used_at IS NOT NULL`
    );

    await client.query("COMMIT");

    return {
      connectionId,
      userId: String(tokenPayload.user_id),
      scope: tokenPayload.scope || null,
      expiresAt: new Date(Date.now() + Number(tokenPayload.expires_in || 21600) * 1000)
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function refreshMercadoLivreAccessToken(connectionId = null) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const params = [];
    let sql = `SELECT ic.*
                 FROM integration_connections ic
                 JOIN affiliate_platforms ap ON ap.id = ic.platform_id
                WHERE ap.code = 'mercadolivre'
                  AND ic.status = 'authorized'`;

    if (connectionId) {
      params.push(connectionId);
      sql += " AND ic.id = $1";
    } else {
      sql += " ORDER BY ic.updated_at DESC";
    }

    sql += " LIMIT 1 FOR UPDATE";

    const result = await client.query(sql, params);
    const connection = result.rows[0];
    if (!connection) {
      throw new Error("Nenhuma conexão OAuth do Mercado Livre autorizada.");
    }

    const refreshToken = decryptSecret(connection.refresh_token_encrypted);
    const tokenPayload = await exchangeRefreshToken(refreshToken);
    const expiresAt = new Date(Date.now() + Number(tokenPayload.expires_in || 21600) * 1000);

    await client.query(
      `UPDATE integration_connections
          SET access_token_encrypted = $2,
              refresh_token_encrypted = $3,
              access_token_expires_at = $4,
              granted_scope = $5,
              status = 'authorized',
              last_sync_at = now(),
              updated_at = now()
        WHERE id = $1`,
      [
        connection.id,
        encryptSecret(tokenPayload.access_token),
        encryptSecret(tokenPayload.refresh_token),
        expiresAt,
        tokenPayload.scope || connection.granted_scope || null
      ]
    );

    await client.query("COMMIT");
    return tokenPayload.access_token;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function getMercadoLivreAccessToken(connectionId = null) {
  if (!process.env.MELI_CLIENT_ID || !process.env.MELI_CLIENT_SECRET || !process.env.MELI_OAUTH_ENCRYPTION_KEY) {
    const legacy = process.env.MELI_ACCESS_TOKEN?.trim();
    if (legacy) return legacy;
    throw new Error(
      "OAuth Mercado Livre não configurado. Defina MELI_CLIENT_ID, MELI_CLIENT_SECRET e MELI_OAUTH_ENCRYPTION_KEY."
    );
  }

  const params = [];
  let sql = `SELECT ic.id, ic.access_token_encrypted, ic.access_token_expires_at
               FROM integration_connections ic
               JOIN affiliate_platforms ap ON ap.id = ic.platform_id
              WHERE ap.code = 'mercadolivre'
                AND ic.status = 'authorized'
                AND ic.access_token_encrypted IS NOT NULL`;

  if (connectionId) {
    params.push(connectionId);
    sql += " AND ic.id = $1";
  } else {
    sql += " ORDER BY ic.updated_at DESC";
  }

  sql += " LIMIT 1";

  const result = await pool.query(sql, params);
  const connection = result.rows[0];

  if (!connection) {
    const legacy = process.env.MELI_ACCESS_TOKEN?.trim();
    if (legacy) return legacy;
    throw new Error("Nenhuma conexão OAuth do Mercado Livre autorizada.");
  }

  if (
    connection.access_token_expires_at &&
    new Date(connection.access_token_expires_at).getTime() > Date.now() + TOKEN_REFRESH_SKEW_MS
  ) {
    return decryptSecret(connection.access_token_encrypted);
  }

  return refreshMercadoLivreAccessToken(connection.id);
}

export async function getMercadoLivreConnectionStatus() {
  const result = await pool.query(
    `SELECT ic.id,
            ic.account_label,
            ic.status,
            ic.account_user_id,
            ic.access_token_expires_at,
            ic.granted_scope,
            ic.updated_at
       FROM integration_connections ic
       JOIN affiliate_platforms ap ON ap.id = ic.platform_id
      WHERE ap.code = 'mercadolivre'
      ORDER BY ic.updated_at DESC
      LIMIT 1`
  );

  const connection = result.rows[0];
  if (!connection) {
    return { configured: false, status: "not_authorized" };
  }

  return {
    configured: true,
    id: connection.id,
    accountLabel: connection.account_label,
    status: connection.status,
    accountUserId: connection.account_user_id,
    accessTokenExpiresAt: connection.access_token_expires_at,
    scope: connection.granted_scope,
    updatedAt: connection.updated_at
  };
}
