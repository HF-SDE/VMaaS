# Backend API – endpoint-reference

Oversigt over alle HTTP-endpoints i `backend/`: hvilke routes der findes, hvad de
forventer som input, og hvad de kan svare – både ved succes og ved fejl.

Kilderne er routerne i [backend/src/api/routes/](../backend/src/api/routes/),
controllerne i [backend/src/api/controllers/](../backend/src/api/controllers/) og
Zod-skemaerne i [shared/schemas/](../shared/schemas/). Hvis denne fil og koden er
uenige, er det koden der gælder – opdatér filen.

---

## Indhold

- [Generelt](#generelt)
  - [Base-URL og format](#base-url-og-format)
  - [Autentificering og middleware](#autentificering-og-middleware)
  - [Valideringsfejl (400)](#valideringsfejl-400)
  - [Rate limiting](#rate-limiting)
  - [Fælles typer](#fælles-typer)
- [Health](#health)
- [Auth (Better Auth)](#auth-better-auth)
- [Me](#me)
- [Tenants](#tenants)
- [Machines](#machines)
- [Products](#products)
- [Sites](#sites)
- [Slots](#slots)
- [Sales](#sales)
- [Alerts](#alerts)
- [Subscriptions](#subscriptions)
- [Device (maskiner)](#device-maskiner)
- [Internal (EMQX)](#internal-emqx)
- [WebSocket](#websocket)
- [Kendte uoverensstemmelser](#kendte-uoverensstemmelser)

---

## Generelt

### Base-URL og format

- Alle routes ligger under `/api`, fx `GET /api/machines`.
- Request- og response-bodies er JSON. Undtagelser: Stripe-webhooken (rå body)
  og `DELETE /api/tenants/members/:userId` (tomt `204`-svar).
- **Datoer** serialiseres som ISO 8601-strenge (`"2026-09-23T10:00:00.000Z"`).
- **Prisma `Decimal`-felter** (`price` på produkter/slots/salg, `latitude`/`longitude`
  på sites) serialiseres som **strenge**, fx `"12.5"`. Undtagelse: de
  aggregerede sales-endpoints (`/sales/map`, `/sales/summary`) svarer med tal.
- Fejl har formen `{ "error": "<besked>" }`, medmindre andet står ved endpointet.

### Autentificering og middleware

Routerne kæder et fast sæt middleware. Hver af dem kan afvise requesten, før
controlleren overhovedet kører. Tabellen nedenfor gælder derfor for **alle**
endpoints, der bruger den pågældende middleware, og gentages ikke ved hvert endpoint.

| Middleware | Hvad den kræver | Fejl |
| --- | --- | --- |
| `requireAuth` | Gyldig Better Auth-session (session-cookie). | `401 { "error": "Unauthorized" }` |
| `requireTenant` | En tenant, taget fra headeren `X-Tenant-Id`, ellers sessionens `activeTenantId`. Brugeren skal være medlem (superadmins er altid medlemmer). | `400 { "error": "No tenant selected" }`<br>`403 { "error": "Not a member of this tenant" }` |
| `requirePermission(p)` | Brugerens rolle i tenanten har permission `p`. | `403 { "error": "Missing permission: <p>" }` |
| `requireSuperAdmin` | `user.isSuperAdmin === true`. | `403 { "error": "Not a super admin" }` |
| `requireSubscription` | Tenanten har et abonnement med status `active` eller `trialing`. Superadmins slipper igennem. | `400 { "error": "No tenant selected" }`<br>`402 { "error": "This organization does not have an active subscription." }`<br>`503 { "error": "Could not verify the subscription for this organization." }` |
| `requireMachine` | Klientcertifikat verificeret af nginx (`:8443`): headerne `X-Client-Verify: SUCCESS` og `X-Client-Serial`. Certifikatet skal være ikke-revokeret og ikke-udløbet, og maskinen aktiveret og ikke deaktiveret. | `401 { "error": "Client certificate required" }` |
| `requireInternalSecret` | Headeren `X-Internal-Secret` er lig `MQTT_INTERNAL_SECRET`. | `401 { "result": "deny" }` |

Permission-nøgler (fra [shared/types/permissions.ts](../shared/types/permissions.ts)):
`tenant:manage`, `tenant:view`, `user:manage`, `user:view`, `role:manage`,
`role:view`, `machine:read`, `machine:write`, `site:read`, `site:write`,
`product:read`, `product:write`, `slot:manage`, `sale:read`, `sale:refund`,
`alert:read`, `alert:resolve`.

I endpoint-afsnittene nedenfor står adgangskravene som fx
**Auth · Tenant · Subscription · `machine:read`**.

**Uhåndterede fejl.** Der er ingen global error handler i Express-appen. Hvis en
controller eller service kaster (fx en `schema.parse()` på en route uden
`validate()`), svarer Express' default handler med **`500` og en HTML-body**, ikke
JSON. Hvor det kan ske, står det ved endpointet som "uhåndteret".

### Valideringsfejl (400)

De fleste routes validerer `req.body` / `req.query` / `req.params` med
`validate(schema)`. Ved fejl:

```json
{
  "error": "Invalid request",
  "details": {
    "formErrors": [],
    "fieldErrors": {
      "body": ["name is required"],
      "query": ["search is required"],
      "params": ["id must be a uuid"]
    }
  }
}
```

`fieldErrors` er nøglet på **første** segment af stien (`body`, `query`, `params`),
så man kan ikke se, hvilket felt i bodyen der fejlede – kun beskederne.

`POST /api/device/events/batch` bruger i stedet `validateDetailed`, som bevarer den
fulde sti, så en enhed kan se, hvilket event i batchen der var ugyldigt:

```json
{
  "error": "Invalid request",
  "issues": [{ "path": ["body", "events", 3, "type"], "message": "type is required" }]
}
```

Query-parametre bliver coercet (fx `?page=2` → `2`). Paging-, sorterings- og
limit-værdier **afvises ikke**, men clampes/whitelistes i servicen, så en
forkert værdi falder tilbage til default.

### Rate limiting

- Hele appen: `RATE_LIMIT_COUNT` requests (default 1000) pr.
  `RATE_LIMIT_RESET_MINUTES` minutter (default 5) pr. IP.
- `POST /api/device/activate`: yderligere 20 requests pr. 15 minutter pr. IP.
- Overskredet: `429` med `RateLimit`/`RateLimit-Policy`-headere (draft-7).

### Fælles typer

**Paginated** (`GetPaginatedResult<T>`) – svaret fra alle `/paginated`-endpoints:

```ts
{
  data: T[];
  page: number;       // 0-baseret
  pageSize: number;
  pageCount: number;
  totalCount: number;
}
```

**Paging-query** – fælles for `/paginated`-endpoints (alle felter valgfri):

| Param | Type | Default | Note |
| --- | --- | --- | --- |
| `page` | number | `0` | 0-baseret, min 0 |
| `pageSize` | number | `10` | 1–100 |
| `sortBy` | string | se endpoint | Ukendte felter ignoreres |
| `sortOrder` | `"asc"` \| `"desc"` | se endpoint | |
| `search` | string | – | Fritekst-søgning |

**Modeller** – rækkerne endpoints svarer med (felter fra
[backend/prisma/schema.prisma](../backend/prisma/schema.prisma)):

| Model | Felter |
| --- | --- |
| `Tenant` | `id`, `name`, `createdAt` |
| `User` | `id`, `email`, `name`, `emailVerified`, `image`, `isSuperAdmin`, `createdAt`, `updatedAt` |
| `Machine` | `id`, `serialNumber`, `tenantId`, `name`, `description`, `status` (`never_seen` \| `online` \| `offline` \| `error`), `lastConnectionEventAt`, `registrationStatus` (`unregistered` \| `claimed` \| `permanent_locked`), `createdAt`, `claimedAt`, `activatedAt`, `disabledAt`, `disabledReason`, `siteId` |
| `Product` | `id`, `tenantId`, `name`, `price` (Decimal-streng), `createdAt`, `archivedAt` |
| `Site` | `id`, `tenantId`, `name`, `addressLine1`, `postalCode`, `city`, `countryCode`, `latitude`, `longitude` (Decimal-strenge), `contactName`, `contactPhone`, `contactEmail`, `createdAt`, `updatedAt` |
| `Slot` | `id`, `machineId`, `productId`, `slotNumber`, `beginX`, `endX`, `beginY`, `endY`, `quantity`, `capacity`, `price` (Decimal-streng eller `null`) |
| `Sale` | `id`, `tenantId`, `machineId`, `productId`, `status` (`pending` \| `completed` \| `failed` \| `refunded`), `price`, `createdAt`, `completedAt` |
| `SimpleSite` | `id`, `name`, `city` |

---

## Health

### `GET /api/health`

Ingen auth.

| Status | Body |
| --- | --- |
| `200` | `{ "status": "ok" }` |

---

## Auth (Better Auth)

### `ALL /api/auth/*`

Håndteres af [Better Auth](https://www.better-auth.com/docs) (konfigureret i
[backend/src/lib/auth.ts](../backend/src/lib/auth.ts)) med email/password slået
til. Det giver bl.a. `POST /api/auth/sign-up/email`, `POST /api/auth/sign-in/email`,
`POST /api/auth/sign-out`, `GET /api/auth/get-session` samt password reset/change.
Input og svar for de endpoints er Better Auths egne – se deres dokumentation.
Fejl fra Better Auth har formen `{ "code": "...", "message": "..." }`.

Derudover tilføjer vores `multi-tenant`-plugin to endpoints:

#### `POST /api/auth/tenant/switch`

Skifter sessionens aktive tenant. Kræver session.

**Body**

| Felt | Type | Note |
| --- | --- | --- |
| `tenantId` | string \| `null` | `null` fjerner den aktive tenant |

| Status | Body |
| --- | --- |
| `200` | `{ "activeTenantId": string \| null }` – og en opdateret session-cookie |
| `401` | Ingen session |
| `403` | `{ "message": "You are not a member of this tenant.", ... }` |
| `500` | `{ "message": "Failed to update session", ... }` |

#### `GET /api/auth/tenant/mine`

Kræver session.

| Status | Body |
| --- | --- |
| `200` | `{ "tenants": Tenant[] }` – superadmins får alle tenants |
| `401` | Ingen session |

---

## Me

### `PUT /api/me`

Opdaterer den indloggede brugers navn. **Auth.**

**Body**

| Felt | Type | Regel |
| --- | --- | --- |
| `name` | string | Trimmes, 1–100 tegn |

| Status | Body |
| --- | --- |
| `200` | `User` |
| `400` | Valideringsfejl |

---

## Tenants

Alle routes kræver **Auth**. Nogle kræver også Tenant og en permission – se hvert
endpoint.

### `GET /api/tenants`

Tenants brugeren er medlem af. **Auth.**

| Status | Body |
| --- | --- |
| `200` | `Tenant[]` – superadmins får alle tenants, sorteret efter navn |

### `POST /api/tenants`

Opretter en tenant. Brugeren bliver ejer (`owner`-rollen), standardrollerne
oprettes, og tenanten får et abonnement med status `pending`. **Auth.**

**Body**

| Felt | Type | Regel |
| --- | --- | --- |
| `name` | string | Påkrævet, trimmes |

| Status | Body |
| --- | --- |
| `201` | `Tenant` |
| `400` | `{ "error": "name is required" }` |
| `500` | `{ "error": "Owner role is not seeded" }` |

### `GET /api/tenants/members`

Alle medlemskaber i tenanten. **Auth · Tenant · `user:view`.**

| Status | Body |
| --- | --- |
| `200` | `Member[]` – se nedenfor |

`Member` er én `UserRole`-række (én pr. rolle, så en bruger med to roller giver to
rækker) med relationer:

```ts
{
  id, userId, roleId, tenantId, /* …øvrige UserRole-felter */
  user: { id: string; name: string; email: string };
  role: { id: string; name: string; tenantId: string; /* … */ };
}
```

### `GET /api/tenants/members/paginated`

**Auth · Tenant · `user:view`.**

**Query:** paging-query (se [Fælles typer](#fælles-typer)). `sortBy`: `name` |
`email` | `role` | `createdAt` (default `name`, `asc`). `search` matcher navn og email.

| Status | Body |
| --- | --- |
| `200` | `Paginated<Member>` |
| `400` | `{ "error": <Zod treeifyError-objekt> }` – **andet format** end de øvrige valideringsfejl |
| `500` | `{ "error": "An unknown error occurred while loading the members" }` |

### `GET /api/tenants/roles`

Tenantens roller. **Auth · Tenant · `role:view`.**

| Status | Body |
| --- | --- |
| `200` | `{ id: string; name: string; permissions: string[] }[]` |

### `POST /api/tenants/roles`

**Auth · Tenant · `role:manage`.**

**Body**

| Felt | Type | Regel |
| --- | --- | --- |
| `name` | string | Påkrævet; trimmes og lowercases |
| `permissions` | string[] | Valgfri, default `[]` |

| Status | Body |
| --- | --- |
| `201` | Den oprettede rolle |
| `409` | `{ "error": "A role with that name already exists" }` |
| `500` | Uhåndteret ved ugyldig body (HTML) |

### `PATCH /api/tenants/roles/:roleId`

**Auth · Tenant · `role:manage`.**

**Params:** `roleId` (string). **Body:** `name?` (string, min 1), `permissions?` (string[]).

| Status | Body |
| --- | --- |
| `200` | `{ "message": "Role updated" }` |
| `404` | `{ "error": "Role not found" }` |
| `409` | `{ "error": "A role with that name already exists" }` |
| `500` | Uhåndteret ved ugyldig body (HTML) |

### `DELETE /api/tenants/roles/:roleId`

**Auth · Tenant · `role:manage`.**

| Status | Body |
| --- | --- |
| `200` | `{ "message": "Role deleted" }` |
| `404` | `{ "error": "Role not found" }` |
| `409` | `{ "error": "This role is assigned to members and cannot be deleted" }` |

### `POST /api/tenants/members`

Inviterer en bruger via email. Invitationen og mailen skrives i samme transaktion
– fejler mailen, oprettes der ingen invitation. **Auth · Tenant · `user:manage`.**

**Body**

| Felt | Type | Regel |
| --- | --- | --- |
| `email` | string | Gyldig email |
| `role` | string | Navnet på en rolle i tenanten |

| Status | Body |
| --- | --- |
| `201` | `TenantInvite`: `id`, `email`, `userId`, `tenantId`, `roleId`, `invitedById`, `status`, `token`, `expiresAt`, `acceptedAt`, `createdAt`, `updatedAt` |
| `400` | `{ "error": <besked> }` – rollen findes ikke |
| `409` | `{ "error": <besked> }` – allerede medlem |
| `502` | `{ "error": <besked> }` – mailen kunne ikke sendes; sikkert at prøve igen |
| `500` | `{ "error": "An unknown error occurred while inviting the member" }`, eller uhåndteret ved ugyldig body (HTML) |

### `PUT /api/tenants/members/:userId/role`

Skifter et medlems rolle. **Auth · Tenant · `user:manage`.**

**Params:** `userId`. **Body:** `{ "roleName": string }`.

| Status | Body |
| --- | --- |
| `200` | `{ "message": "Role updated successfully" }` – også hvis brugeren ikke er medlem |
| `400` | Ukendt rolle – kastes som Better Auth `APIError` og ender i Express' default handler (ikke JSON) |

### `DELETE /api/tenants/members/:userId`

Fjerner alle brugerens roller i tenanten. **Auth · Tenant · `user:manage`.**

| Status | Body |
| --- | --- |
| `204` | (tom) |
| `409` | `{ "error": "Cannot remove the last owner of a tenant" }` |

### `GET /api/tenants/invites/:inviteId`

Læser en invitation til `/invite/[id]`-siden. Kræver kun login – ikke medlemskab.
En invitation til en anden email giver stadig `200`, med `matchesViewer: false`.
**Auth.**

**Params:** `inviteId` (uuid).

| Status | Body |
| --- | --- |
| `200` | `InviteDetail` – se nedenfor |
| `404` | `{ "error": <besked> }` |
| `500` | `{ "error": "An unknown error occurred while loading the invitation" }`, eller uhåndteret ved ugyldigt uuid (HTML) |

```ts
InviteDetail = {
  id: string;
  email: string;
  tenantId: string;
  tenantName: string;
  roleName: string;
  invitedBy?: string;
  status: "pending" | "accepted" | "expired" | "revoked" | "rejected";
  expiresAt: string;
  matchesViewer: boolean;   // matcher den indloggede brugers email
  alreadyMember: boolean;
}
```

### `POST /api/tenants/invites/:inviteId/respond`

Accepterer eller afviser en invitation. **Auth.**

**Params:** `inviteId` (uuid). **Body:** `{ "status": "accepted" | "rejected" }`.

| Status | Body |
| --- | --- |
| `200` | `{ "tenantId": string, "message": "Invitation accepted" \| "Invitation declined" }` |
| `403` | `{ "error": <besked> }` – logget ind som en anden email end den inviterede |
| `404` | `{ "error": <besked> }` |
| `409` | `{ "error": <besked> }` – udløbet eller allerede besvaret |
| `500` | `{ "error": "An unknown error occurred while responding to the invitation" }`, eller uhåndteret ved ugyldig input (HTML) |

---

## Machines

Typer brugt nedenfor:

```ts
MachineListItem = Machine & { site: SimpleSite }

MachineDetail = MachineListItem & {
  canDelete: boolean;  // ingen slots og ingen salg
  kpi: {
    days: number;        // vinduet efter clamping
    since: string;
    sales: {
      revenue: { current: number; previous: number };
      count:   { current: number; previous: number };
    };
    stock: { slots: number; quantity: number; capacity: number; emptySlots: number };
    alerts: { open: number; logged: { current: number; previous: number } };
    lastSaleAt: string | null;
  };
}

MachineWithoutTenant = Machine & { site: SimpleSite | null; slots: Slot[] }
```

### Superadmin-routes (ikke tenant-scoped)

#### `GET /api/machines/without-tenant`

Maskiner der endnu ikke er tildelt en tenant. **Auth · SuperAdmin.**

| Status | Body |
| --- | --- |
| `200` | `MachineWithoutTenant[]` |

#### `GET /api/machines/without-tenant/:id`

**Auth · SuperAdmin.** **Params:** `id` (uuid).

| Status | Body |
| --- | --- |
| `200` | `MachineWithoutTenant` (slots sorteret efter `slotNumber`) |
| `400` | Valideringsfejl |
| `404` | `{ "error": "Machine not found" }` |
| `500` | `{ "error": "An unknown error occurred while loading the machine" }` |

#### `POST /api/machines`

Opretter en maskine uden tenant og site. Serienummeret genereres (`VM-…`).
**Auth · SuperAdmin.**

**Body:** `{ "name": string }` (trimmes, min 1).

| Status | Body |
| --- | --- |
| `201` | `Machine` |
| `400` | Valideringsfejl |
| `500` | `{ "error": "An unknown error occurred while creating the machine" }` |

#### `POST /api/machines/save-slot-layout`

Gemmer hele slot-layoutet for en maskine. Slots uden `id` oprettes, slots med `id`
opdateres, og gemte slots der ikke er med, slettes. **Auth · SuperAdmin.**

**Body**

```ts
{
  machineId: string;   // uuid
  columns: number;     // heltal ≥ 1
  rows: number;        // heltal ≥ 1
  slots: {
    id?: string;       // uuid, udelades for nye slots
    slotNumber: number;
    beginX: number; endX: number;   // 0-baseret, end ≥ begin
    beginY: number; endY: number;
    capacity: number;  // heltal ≥ 0
  }[];
}
```

Valideringen afviser også layouts hvor slots ligger uden for gitteret, har
duplikerede `slotNumber`/`id`, overlapper, eller har tom plads under sig.

| Status | Body |
| --- | --- |
| `200` | `Slot[]` |
| `400` | Valideringsfejl, eller `{ "error": "One or more slots do not belong to this machine" }` |
| `404` | `{ "error": "Machine not found" }` |
| `500` | `{ "error": "An unknown error occurred while saving the slot layout" }` |

### Tenant-routes

Alle nedenstående kræver **Auth · Tenant · Subscription** plus den nævnte permission.

#### `GET /api/machines`

**`machine:read`.**

| Status | Body |
| --- | --- |
| `200` | `MachineListItem[]` |
| `500` | `{ "error": "An unknown error occurred while loading the machines" }` |

#### `GET /api/machines/paginated`

**`machine:read`.** **Query:** paging-query. `sortBy`: `name` | `site` | `status` |
`createdAt` (default `createdAt`, `desc`).

| Status | Body |
| --- | --- |
| `200` | `Paginated<MachineListItem>` |
| `400` | Valideringsfejl |
| `500` | `{ "error": "An unknown error occurred while loading the machines" }` |

#### `GET /api/machines/simple-search`

Til maskine-pickeren. **`machine:read`.**

**Query:** `search` (påkrævet, min 1 tegn), `limit` (default 10, max 25).

| Status | Body |
| --- | --- |
| `200` | `{ id: string; name: string; site: SimpleSite }[]` |
| `400` | Valideringsfejl (fx manglende `search`) |
| `500` | `{ "error": "An unknown error occurred while searching the machines" }` |

#### `POST /api/machines/claim`

Administratorens del af aktiveringen: binder maskinen til tenant og site og
returnerer en engangskode, der tastes ind på maskinen. Koden vises kun her – kun
hashen gemmes. **`machine:write`.**

**Body**

| Felt | Type | Regel |
| --- | --- | --- |
| `serialNumber` | string | Trimmes, min 1 |
| `siteId` | string | uuid, site i tenanten |

| Status | Body |
| --- | --- |
| `201` | `{ "machineId": string, "oneTimeCode": string /* 8 cifre */, "expiresAt": string }` |
| `400` | Valideringsfejl |
| `404` | `{ "error": "No machine has that serial number" }` eller `{ "error": "The site does not exist for this tenant" }` |
| `409` | `{ "error": "The machine is already claimed" }` |
| `500` | `{ "error": "An unknown error occurred while claiming the machine" }` |

Koden udløber efter `ACTIVATION_CODE_TTL_MINUTES` (default 60).

#### `GET /api/machines/:id`

**`machine:read`.** **Params:** `id` (uuid). **Query:** `days` (KPI-vindue,
default 30, clampes til 1–365).

| Status | Body |
| --- | --- |
| `200` | `MachineDetail` |
| `400` | Valideringsfejl |
| `404` | `{ "error": "Machine not found" }` |
| `500` | `{ "error": "An unknown error occurred while loading the machine" }` |

#### `PATCH /api/machines/:id`

**`machine:write`.** **Params:** `id` (uuid).

**Body** – mindst ét felt:

| Felt | Type | Regel |
| --- | --- | --- |
| `name` | string | Valgfri, trimmes, min 1 |
| `siteId` | string | Valgfri, uuid (kan ikke være `null`) |

| Status | Body |
| --- | --- |
| `200` | `MachineDetail` |
| `400` | Valideringsfejl, eller `{ "error": "The selected site does not exist" }` |
| `404` | `{ "error": "Machine not found" }` |
| `500` | `{ "error": "An unknown error occurred while updating the machine" }` |

#### `DELETE /api/machines/:id`

**`machine:write`.** **Params:** `id` (uuid).

| Status | Body |
| --- | --- |
| `200` | `{ "success": true }` |
| `400` | Valideringsfejl |
| `404` | `{ "error": "Machine not found" }` |
| `409` | `{ "error": "Machine is used by one or more slots or sales" }` |
| `500` | `{ "error": "An unknown error occurred while deleting the machine" }` |

#### `POST /api/machines/:id/disable`

Tager en maskine ud af drift: HTTP og nye MQTT-forbindelser afvises med det samme,
og en åben MQTT-session bliver kicket. **`machine:write`.**

**Params:** `id` (uuid).

**Body**

| Felt | Type | Regel |
| --- | --- | --- |
| `reason` | string | Påkrævet, trimmes, min 1 |
| `revokeCertificate` | boolean | Valgfri, default `false` |

| Status | Body |
| --- | --- |
| `200` | `{ "machineId": string, "kicked": boolean }` |
| `400` | Valideringsfejl |
| `404` | `{ "error": "The machine does not exist" }` |
| `500` | `{ "error": "An unknown error occurred while disabling the machine" }` |

---

## Products

Alle routes kræver **Auth · Tenant · Subscription** plus den nævnte permission.

`ProductDetail = Product & { canDelete: boolean }` (ingen slots og ingen salg).

### `GET /api/products`

**`product:read`.**

| Status | Body |
| --- | --- |
| `200` | `Product[]` |
| `500` | `{ "error": "An unknown error occurred while loading the products" }` |

### `GET /api/products/paginated`

**`product:read`.** **Query:** paging-query plus `includeArchived` (`"true"` /
`"false"`, default: arkiverede er skjult). `sortBy`: `name` | `price` | `createdAt`
(default `createdAt`, `desc`).

| Status | Body |
| --- | --- |
| `200` | `Paginated<Product>` |
| `400` | Valideringsfejl |
| `500` | `{ "error": "An unknown error occurred while loading the products" }` |

### `GET /api/products/simple-search`

Til produkt-pickeren. **`product:read`.**

**Query:** `search` (påkrævet, min 1 tegn), `limit` (default 10, max 25).

| Status | Body |
| --- | --- |
| `200` | `{ id: string; name: string; price: string }[]` |
| `400` | Valideringsfejl |
| `500` | `{ "error": "An unknown error occurred while searching the products" }` |

### `POST /api/products`

**`product:write`.**

**Body**

| Felt | Type | Regel |
| --- | --- | --- |
| `name` | string | Min 1 |
| `price` | number | > 0 (JSON-tal, ikke streng) |

| Status | Body |
| --- | --- |
| `201` | `Product` |
| `400` | Valideringsfejl |
| `500` | `{ "error": "An unknown error occurred while creating the product" }` |

### `GET /api/products/:id`

**`product:read`.** **Params:** `id` (uuid).

| Status | Body |
| --- | --- |
| `200` | `ProductDetail` |
| `400` | Valideringsfejl |
| `404` | `{ "error": "Product not found" }` |
| `500` | `{ "error": "An unknown error occurred while loading the product" }` |

### `PATCH /api/products/:id`

**`product:write`.** **Params:** `id` (uuid). **Body** – mindst ét felt: `name?`
(string, min 1), `price?` (number > 0).

| Status | Body |
| --- | --- |
| `200` | `ProductDetail` |
| `400` | Valideringsfejl |
| `404` | `{ "error": "Product not found" }` |
| `500` | `{ "error": "An unknown error occurred while updating the product" }` |

### `DELETE /api/products/:id`

**`product:write`.** **Params:** `id` (uuid).

| Status | Body |
| --- | --- |
| `200` | `{ "success": true }` |
| `400` | Valideringsfejl |
| `404` | `{ "error": "Product not found" }` |
| `409` | `{ "error": "Product is used by one or more slots" }` eller `{ "error": "Product is referenced by other data" }` |
| `500` | `{ "error": "An unknown error occurred while deleting the product" }` |

### `POST /api/products/:id/archive` · `POST /api/products/:id/unarchive`

Sætter/rydder `archivedAt`. **`product:write`.** **Params:** `id` (uuid). Ingen body.

| Status | Body |
| --- | --- |
| `200` | `ProductDetail` |
| `400` | Valideringsfejl |
| `404` | `{ "error": "Product not found" }` |
| `500` | `{ "error": "An unknown error occurred while archiving the product" }` (hhv. `unarchiving`) |

---

## Sites

Alle routes kræver **Auth · Tenant · Subscription** plus den nævnte permission.

`SiteDetail = Site & { machineCount: number; canDelete: boolean }` (kan kun slettes
uden maskiner).

### `GET /api/sites`

**`site:read`.**

| Status | Body |
| --- | --- |
| `200` | `Site[]`, sorteret efter navn |
| `500` | `{ "error": "An unknown error occurred while loading the sites" }` |

### `GET /api/sites/paginated`

**`site:read`.** **Query:** paging-query. `sortBy`: `name` | `city` | `createdAt`
(default `createdAt`, `desc`).

| Status | Body |
| --- | --- |
| `200` | `Paginated<Site>` |
| `400` | Valideringsfejl |
| `500` | `{ "error": "An unknown error occurred while loading the sites" }` |

### `GET /api/sites/simple-search`

Til site-pickeren. **`site:read`.**

**Query:** `search` (påkrævet, min 1 tegn), `limit` (default 10, max 25).

| Status | Body |
| --- | --- |
| `200` | `SimpleSite[]` |
| `400` | Valideringsfejl |
| `500` | `{ "error": "An unknown error occurred while searching the sites" }` |

### `POST /api/sites`

**`site:write`.**

**Body**

| Felt | Type | Regel |
| --- | --- | --- |
| `name` | string | Påkrævet, trimmes, min 1 |
| `addressLine1` | string | Valgfri; `""` behandles som udeladt |
| `postalCode` | string | Valgfri |
| `city` | string | Valgfri |
| `countryCode` | string | Valgfri; 2 bogstaver, uppercases (`"dk"` → `"DK"`) |
| `contactName` | string | Valgfri |
| `contactPhone` | string | Valgfri |
| `contactEmail` | string | Valgfri; gyldig email |
| `latitude` | number \| `null` | Valgfri; −90 til 90 |
| `longitude` | number \| `null` | Valgfri; −180 til 180 |

`latitude` og `longitude` skal sendes sammen eller slet ikke.

| Status | Body |
| --- | --- |
| `201` | `Site` |
| `400` | Valideringsfejl |
| `500` | `{ "error": "An unknown error occurred while creating the site" }` |

### `GET /api/sites/:id`

**`site:read`.** **Params:** `id` (uuid).

| Status | Body |
| --- | --- |
| `200` | `SiteDetail` |
| `400` | Valideringsfejl |
| `404` | `{ "error": "Site not found" }` |
| `500` | `{ "error": "An unknown error occurred while loading the site" }` |

### `PATCH /api/sites/:id`

**`site:write`.** **Params:** `id` (uuid).

**Body:** samme felter som `POST`, alle valgfri, mindst ét påkrævet. Forskellen:
her betyder et udeladt felt "rør ikke", mens `""` eller `null` **rydder** feltet.

| Status | Body |
| --- | --- |
| `200` | `SiteDetail` |
| `400` | Valideringsfejl |
| `404` | `{ "error": "Site not found" }` |
| `500` | `{ "error": "An unknown error occurred while updating the site" }` |

### `DELETE /api/sites/:id`

**`site:write`.** **Params:** `id` (uuid).

| Status | Body |
| --- | --- |
| `200` | `{ "success": true }` |
| `400` | Valideringsfejl |
| `404` | `{ "error": "Site not found" }` |
| `409` | `{ "error": "Site still has one or more machines" }` |
| `500` | `{ "error": "An unknown error occurred while deleting the site" }` |

---

## Slots

Alle routes kræver **Auth · Tenant · Subscription** plus den nævnte permission.

`SlotListItem = Slot & { product: { id: string; name: string } | null }`

### `GET /api/slots`

En maskines slots. **`machine:read`.**

**Query:** `machineId` (påkrævet, uuid).

| Status | Body |
| --- | --- |
| `200` | `SlotListItem[]` |
| `400` | Valideringsfejl |
| `404` | `{ "error": "Machine not found" }` |
| `500` | `{ "error": "An unknown error occurred while loading the slots" }` |

### `GET /api/slots/low-stock`

Slots i hele tenanten med højst 20 % af kapaciteten tilbage, tomeste først, max 50.
**`machine:read`.** Intet input.

| Status | Body |
| --- | --- |
| `200` | `LowStockSlot[]` – se nedenfor |
| `500` | `{ "error": "An unknown error occurred while loading the low stock slots" }` |

```ts
LowStockSlot = {
  slotId: string;
  slotNumber: number;
  quantity: number;
  capacity: number;
  productName: string | null;
  machineId: string;
  machineName: string;
  siteId: string;
  siteName: string;
}
```

### `PATCH /api/slots/:id`

Opdaterer en slot. Ændres `quantity`, logges en lagerbevægelse på den indloggede
bruger. **`slot:manage`.**

**Params:** `id` (uuid).

**Body** – mindst ét felt:

| Felt | Type | Regel |
| --- | --- | --- |
| `productId` | string | Valgfri, uuid på et produkt i tenanten |
| `quantity` | number | Valgfri, heltal ≥ 0 |
| `capacity` | number | Valgfri, heltal ≥ 1 |
| `price` | number \| `null` | Valgfri, ≥ 0. `null` = brug produktets pris |

| Status | Body |
| --- | --- |
| `200` | `SlotListItem` |
| `400` | Valideringsfejl, eller `{ "error": "The selected product does not exist" }` |
| `404` | `{ "error": "Slot not found" }` |
| `409` | `{ "error": "The quantity does not fit the slot's capacity" }` |
| `500` | `{ "error": "An unknown error occurred while updating the slot" }` |

---

## Sales

Alle routes kræver **Auth · Tenant · Subscription · `sale:read`.**

### `GET /api/sales`

Alle tenantens salg, nyeste først.

| Status | Body |
| --- | --- |
| `200` | `(Sale & { machine: Machine & { site: { id, name } }; product: Product \| null })[]` |
| `500` | Uhåndteret ved databasefejl (HTML) |

### `GET /api/sales/map`

Gennemførte salg placeret på deres sites koordinater (ét punkt pr. salg).

**Query:** `days` (default 30, clampes til 1–365).

| Status | Body |
| --- | --- |
| `200` | `SaleMapPoint[]` – se nedenfor |
| `400` | Valideringsfejl |
| `500` | `{ "error": "An unknown error occurred while loading the sales map" }` |

```ts
SaleMapPoint = {
  id: string;
  price: number;
  createdAt: string;
  productName: string | null;
  machineId: string;
  machineName: string;
  siteId: string;
  siteName: string;
  latitude: number;
  longitude: number;
}
```

### `GET /api/sales/summary`

Nøgletal til dashboardet. Tæller kun `completed`-salg.

**Query:** `days` (default 30, clampes til 1–90).

| Status | Body |
| --- | --- |
| `200` | `SalesSummary` – se nedenfor |
| `400` | Valideringsfejl |
| `500` | `{ "error": "An unknown error occurred while loading the sales summary" }` |

```ts
SalesSummary = {
  today:      { revenue: number; count: number };
  last7Days:  { revenue: number; count: number };
  last30Days: { revenue: number; count: number };
  daily: { date: string /* YYYY-MM-DD, UTC */; revenue: number; count: number }[]; // én pr. dag, ældste først
  topProducts: { productId: string; name: string; count: number; revenue: number }[]; // max 5
}
```

---

## Alerts

Alle routes kræver **Auth · Tenant · Subscription** plus den nævnte permission.

```ts
MachineAlertRow = {
  id: string;
  type: "tamper" | "offline" | "error";
  machineId: string;
  machineName: string;
  createdAt: string;
  occurredAt: string;
  resolvedAt: string | null;   // null = åben
  message: string;
  siteId: string;
  siteName: string;
  contactPhone: string | null;
  contactEmail: string | null;
}
```

### `GET /api/alerts/paginated`

**`alert:read`.** Sorteres efter `occurredAt`.

**Query** (alle valgfri):

| Param | Type | Note |
| --- | --- | --- |
| `page` | number | 0-baseret |
| `pageSize` | number | Default 50, max 100 |
| `sortOrder` | `"asc"` \| `"desc"` | Default `desc` |
| `search` | string | |
| `machineIds` | uuid[] | Gentaget eller kommasepareret: `?machineIds=a,b&machineIds=c` |
| `siteIds` | uuid[] | Som ovenfor |
| `alertTypes` | (`tamper` \| `offline` \| `error`)[] | Som ovenfor |
| `dateFrom` | `YYYY-MM-DD` | Inklusiv |
| `dateTo` | `YYYY-MM-DD` | Inklusiv |

| Status | Body |
| --- | --- |
| `200` | `Paginated<MachineAlertRow>` |
| `400` | Valideringsfejl |
| `500` | `{ "error": "An unknown error occurred while loading the alerts" }` |

### `GET /api/alerts/summary`

**`alert:read`.** Intet input.

| Status | Body |
| --- | --- |
| `200` | `{ openByType: { tamper: number; offline: number; error: number }; openTotal: number; recent: MachineAlertRow[] /* max 50, nyeste først */ }` |
| `500` | `{ "error": "An unknown error occurred while loading the alert summary" }` |

### `PATCH /api/alerts/:id/resolve`

**`alert:resolve`.** **Params:** `id` (uuid). Ingen body.

| Status | Body |
| --- | --- |
| `200` | `MachineAlertRow` |
| `400` | Valideringsfejl |
| `404` | `{ "error": "Alert not found" }` |
| `409` | `{ "error": "That alert has already been resolved" }` |
| `500` | `{ "error": "An unknown error occurred while resolving the alert" }` |

---

## Subscriptions

Alle routes (undtagen webhooken) kræver **Auth · Tenant**. Ingen af dem kræver et
aktivt abonnement – de er netop dem, man bruger til at få eller administrere et.
Alle routes der ændrer eller viser fakturering, kræver at brugeren er **ejer** af
tenanten; ellers `403 { "error": "Only an owner can change billing for this organization." }`
(ved `/invoices`: `"...can view billing history..."`).

### `GET /api/subscriptions/current`

Tenantens abonnementsstatus. Alle medlemmer må læse den.

| Status | Body |
| --- | --- |
| `200` | Se nedenfor |
| `500` | `{ "error": "An unknown error occurred while loading the subscription" }` |

```ts
{
  status: "pending" | "trialing" | "active" | "past_due" | "canceled" | "incomplete" | "unpaid";
  plan: "monthly" | "yearly" | null;
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  hasAccess: boolean;   // om requireSubscription ville lukke igennem
  isOwner: boolean;
}
```

### `GET /api/subscriptions/invoices`

Betalte fakturaer, hentet direkte fra Stripe (cursor-paging). **Ejer.**

**Query:** `limit` (valgfri), `startingAfter` (valgfri; `nextCursor` fra forrige side).

| Status | Body |
| --- | --- |
| `200` | Se nedenfor |
| `400` | Valideringsfejl |
| `403` | Ikke ejer |
| `502` | `{ "error": "Could not reach Stripe. Please try again." }` |
| `500` | `{ "error": "An unknown error occurred while loading the invoices" }` |

```ts
{
  data: {
    id: string;
    number: string | null;
    created: number;       // Unix-sekunder (ikke ms)
    amountPaid: number;    // minor units: 29900 = 299,00 kr.
    currency: string;
    pdfUrl: string | null;
    hostedUrl: string | null;
  }[];
  hasMore: boolean;
  nextCursor: string | null;
}
```

### `POST /api/subscriptions/checkout`

Opretter en Stripe Checkout-session. Abonnementet aktiveres først, når Stripes
webhook melder det aktivt. **Ejer.**

**Body:** `{ "plan": "monthly" | "yearly" }`.

| Status | Body |
| --- | --- |
| `200` | `{ "url": string }` – send browseren hertil |
| `400` | Valideringsfejl |
| `403` | Ikke ejer |
| `409` | `{ "error": "This organization already has an active subscription." }` |
| `502` | `{ "error": "Could not reach Stripe. Please try again." }` |
| `500` | `{ "error": "An unknown error occurred while starting checkout" }` |

### `POST /api/subscriptions/cancel`

Opsiger abonnementet ved udgangen af den betalte periode. **Ejer.** Ingen body.

| Status | Body |
| --- | --- |
| `200` | `{ "cancelAtPeriodEnd": true, "currentPeriodEnd": string \| null }` |
| `403` | Ikke ejer |
| `404` | `{ "error": "No subscription was found for this organization." }` |
| `409` | `{ "error": "This organization has no subscription to cancel." }` |
| `502` | `{ "error": "Could not reach Stripe. Please try again." }` |
| `500` | `{ "error": "An unknown error occurred while canceling the subscription" }` |

### `POST /api/subscriptions/portal`

Åbner Stripe Customer Portal (skift kort, se abonnement). **Ejer.** Ingen body.

| Status | Body |
| --- | --- |
| `200` | `{ "url": string }` |
| `403` | Ikke ejer |
| `409` | `{ "error": "This organization has no billing details to manage yet." }` |
| `502` | `{ "error": "Could not reach Stripe. Please try again." }` |
| `500` | `{ "error": "An unknown error occurred while opening the billing portal" }` |

### `POST /api/subscriptions/webhook`

Kaldes af Stripe, ikke af frontend. Ingen session; Stripe-signaturen er
autentificeringen.

**Headers:** `Stripe-Signature`. **Body:** Stripes rå event-JSON (læses som bytes).

| Status | Body |
| --- | --- |
| `200` | `{ "received": true }` |
| `400` | `{ "error": <besked> }` – ugyldig signatur, eller eventet kunne ikke anvendes (Stripe prøver igen) |

---

## Device (maskiner)

Kaldes af maskinernes firmware, ikke af browseren. Ingen af requestene indeholder
et maskine-, tenant- eller site-id – maskinen udledes af klientcertifikatet.

### `POST /api/device/activate`

Maskinens del af aktiveringen: bytter engangskoden fra
[`POST /api/machines/claim`](#post-apimachinesclaim) og en CSR til et certifikat.
Ingen auth – koden *er* credentialet. Ekstra rate limit: 20 pr. 15 min pr. IP.

**Body**

| Felt | Type | Regel |
| --- | --- | --- |
| `machineId` | string | uuid |
| `code` | string | Trimmes, 1–64 tegn |
| `csr` | string | PEM, starter med `-----BEGIN CERTIFICATE REQUEST-----`, max 8192 tegn |

| Status | Body |
| --- | --- |
| `200` | Se nedenfor |
| `400` | Valideringsfejl, eller `{ "error": "Activation rejected" }` – samme svar for forkert kode, udløbet kode, for mange forsøg, afvist CSR, allerede brugt aktivering og deaktiveret maskine |
| `429` | Rate limit |
| `500` | `{ "error": "An unknown error occurred while activating" }` |

```ts
{
  certificate: string;     // PEM
  caCertificate: string;   // PEM
  machineId: string;
  tenantId: string;
  siteId: string;
  topicPrefix: string;     // MQTT topic-prefix for maskinen
  mqtt: { host: string; port: number };
}
```

### mTLS-routes

Alle nedenstående kræver **Machine** (klientcertifikat via nginx `:8443`). På
`:80` svarer nginx `404` for `/api/device/*`.

#### `GET /api/device/configuration`

Nyeste publicerede konfiguration for maskinen.

| Status | Body |
| --- | --- |
| `200` | `{ "version": number, "payload": object }` |
| `404` | `{ "error": "No configuration published" }` |
| `500` | `{ "error": "An unknown error occurred while reading the configuration" }` |

#### `POST /api/device/command-results`

Rapporterer resultatet af en kommando sendt til maskinen.

**Body**

| Felt | Type | Regel |
| --- | --- | --- |
| `commandId` | string | Trimmes, min 1 |
| `status` | `"completed"` \| `"failed"` | |
| `detail` | string | Valgfri, max 2000 |
| `completedAt` | string | Valgfri, ISO datetime |

| Status | Body |
| --- | --- |
| `200` | `{ "applied": boolean }` – `false` hvis kommandoen allerede var afsluttet |
| `400` | Valideringsfejl |
| `404` | `{ "error": "Unknown command" }` |
| `500` | `{ "error": "An unknown error occurred while recording the result" }` |

#### `POST /api/device/events`

Ét event fra maskinen.

**Body**

| Felt | Type | Regel |
| --- | --- | --- |
| `type` | string | Trimmes, 1–64 tegn, fx `"cash_sale"` |
| `payload` | object | Valgfri, default `{}` |
| `eventId` | string | Valgfri, 1–128 tegn; bruges til deduplikering |
| `sequenceNumber` | number | Valgfri, heltal ≥ 0 |
| `occurredAt` | string | ISO datetime |
| `uptimeMs` | number | Heltal ≥ 0; ms siden eventet skete, målt ved afsendelse |

Mindst én af `occurredAt` og `uptimeMs` skal med (en maskine uden ur sender `uptimeMs`).

For `type: "cash_sale"` valideres `payload` desuden som:

| Felt | Type | Regel |
| --- | --- | --- |
| `slot` | number | Heltal 1–32 |
| `price_minor` | number | Heltal ≥ 0 (øre) |
| `received_minor` | number | Heltal ≥ 0 (øre) |
| `status` | `"completed"` \| `"failed"` | |
| `reason` | string | Valgfri, max 64 |
| `currency` | string | Valgfri, 3 tegn, default `"DKK"` |

| Status | Body |
| --- | --- |
| `201` | `{ "stored": boolean }` – `false` hvis eventet allerede er modtaget (dublet) |
| `400` | Valideringsfejl |
| `422` | `{ "error": "cash_sale payload rejected: ..." }` |
| `500` | `{ "error": "An unknown error occurred while storing the event" }` |

#### `POST /api/device/events/batch`

Maskinen tømmer sin offline-kø.

**Body:** `{ "events": Event[] }` – 1–50 events, hvert med samme regler som
`POST /api/device/events`.

| Status | Body |
| --- | --- |
| `201` | `{ "received": number, "stored": number }` – `stored` kan være lavere pga. dubletter |
| `400` | Detaljeret valideringsfejl (`issues` med fuld sti – se [Valideringsfejl](#valideringsfejl-400)) |
| `500` | `{ "error": "An unknown error occurred while storing the events" }` |

#### `POST /api/device/certificate/renew`

Roterer maskinens certifikat. Det nuværende certifikat autoriserer det nye.

**Body:** `{ "csr": string }` – PEM, samme regler som ved aktivering.

| Status | Body |
| --- | --- |
| `200` | `{ "certificate": string, "caCertificate": string }` |
| `400` | Valideringsfejl, eller `{ "error": "Activation rejected", "reason": "CSR_REJECTED" }` |
| `500` | `{ "error": "An unknown error occurred while rotating the certificate" }` |

---

## Internal (EMQX)

Kaldes kun af MQTT-brokeren (EMQX) på det interne netværk. Alle kræver headeren
`X-Internal-Secret`; forkert eller manglende secret giver `401 { "result": "deny" }`.

### `POST /api/internal/mqtt/authn`

Må klienten forbinde?

**Body:** `{ "clientid": string, "cert_subject": string }`. `clientid` skal være lig
certifikatets CN (maskinens id).

| Status | Body |
| --- | --- |
| `200` | `{ "result": "allow" \| "deny" }` |

### `POST /api/internal/mqtt/authz`

Må klienten publish/subscribe på et topic?

**Body:** `{ "clientid": string, "cert_subject": string, "action": "publish" | "subscribe", "topic": string }`.

| Status | Body |
| --- | --- |
| `200` | `{ "result": "allow" \| "deny" }` |

### `POST /api/internal/mqtt/connection`

EMQX rule-engine-hook for `client.connected` / `client.disconnected`. Opdaterer
maskinens online/offline-status.

**Body:** `{ "clientid": string, "event": "client.connected" | "client.disconnected", "occurredAt": number /* ms */, "reason"?: string }`.

| Status | Body |
| --- | --- |
| `200` | `{}` – altid, også ved ukendte events, ugyldig body eller databasefejl (logges) |

---

## WebSocket

### `GET /api/ws` (upgrade)

Live-opdateringer til admin-frontenden. Ikke en Express-route – upgrade håndteres i
[backend/src/lib/ws/server.ts](../backend/src/lib/ws/server.ts).

- Kræver session-cookie og en `Origin`-header, der matcher `FRONTEND_URL`.
- Tenant tages fra `?tenantId=…`, ellers sessionens `activeTenantId`, og brugeren
  skal være medlem.
- Afvises forbindelsen, lukkes socketten uden svar.

---

## Kendte uoverensstemmelser

Ting der er fundet under dokumentationen, og som man skal være opmærksom på som
klient – eller rette:

1. **Ingen global error handler.** Kastede fejl bliver til `500` med HTML fra
   Express' default handler i stedet for JSON.
2. **Tenants-routes uden `validate()`.** `POST /tenants/members`, `POST /tenants/roles`,
   `PATCH /tenants/roles/:roleId`, `GET /tenants/invites/:inviteId` og
   `POST /tenants/invites/:inviteId/respond` parser input i controlleren med
   `.parse()`. Ugyldigt input giver derfor `500` (HTML) i stedet for `400`.
3. **`GET /tenants/members/paginated`** svarer `400` med
   `{ error: <treeifyError> }` – et andet format end resten af API'et.
4. **`PUT /tenants/members/:userId/role`** kaster en Better Auth `APIError` ved ukendt
   rolle (ikke-JSON-svar), og svarer `200` selv hvis `userId` ikke er medlem af tenanten.
5. **`POST /tenants`** har ikke `validate()` og ignorerer `createTenantSchema`.
6. **`POST /device/certificate/renew`** svarer `"Activation rejected"` ved en afvist
   CSR, selvom det er en fornyelse.
7. **`DELETE /tenants/members/:userId`** har to `console.log`-debuglinjer i
   controlleren.
