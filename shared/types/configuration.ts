/**
 * What happened to one machine's prices after a customer edit
 * (PATCH /slots/:id, PATCH /products/:id), returned next to the saved row as
 * `publish` so the admin can tell the user whether the machine follows.
 *
 * - `sent`: a new version was published and the machine is online; the
 *   outcome follows over the websocket as `configuration.result`.
 * - `offline`: a new version was published, but the machine is offline; it
 *   picks the version up when it next connects.
 * - `unchanged`: the machine already runs these prices.
 * - `not_published`: the machine has never been published, so there is no
 *   reviewed wiring to publish the prices on top of.
 */
export type PricePublishStatus = "sent" | "offline" | "unchanged" | "not_published";

export type PricePublishOutcome = {
  machineId: string;
  machineName: string;
  status: PricePublishStatus;
  /** Set for `sent` and `offline`; matches `configuration.result`'s commandId. */
  commandId: string | null;
};
