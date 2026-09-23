/**
 * Platform-to-machine commands.
 *
 * A command says only that something changed; the machine then fetches the
 * detail over HTTPS. That split is the one `topics.ts` describes, and it is what
 * makes redelivery safe: the device always fetches the *latest* configuration,
 * so a repeated or delayed QoS-1 delivery can never apply an older one.
 */
import { prisma } from "@/lib/prisma";

import { publishToBroker } from "./client";
import { buildTopicPrefix, type MachineIdentity } from "./topics";

/**
 * Send one command. Broker failures are logged, never thrown: the command row is
 * already stored, and a machine that missed the message gets it from
 * `redeliverOpenCommands` when it next connects. Throwing here would roll back a
 * configuration that is correctly published.
 */
export async function publishCommand(
  machine: MachineIdentity,
  payload: Record<string, unknown>,
  commandId: string,
): Promise<void> {
  const topic = `${buildTopicPrefix(machine)}/commands/${commandId}`;

  try {
    await publishToBroker(topic, payload);
  } catch (error) {
    console.warn(`mqtt: could not publish ${topic}, leaving it for redelivery:`, error);
  }
}

/**
 * Republish everything still open for a machine.
 *
 * Called when the broker reports the machine connected. This is what closes the
 * hole left by `retain: false`: a machine that was offline when a configuration
 * was published never saw the message, but the row is still pending.
 *
 * Wrapped in its own try/catch, separate from `publishCommand`'s: the caller in
 * connection.service.ts fires this without awaiting it, answering EMQX's
 * webhook before a republish could finish. With nothing to attach a `.catch()`
 * to, a database failure here (the machine or command lookup, not the broker
 * publish, which `publishCommand` already swallows) must not become an
 * unhandled rejection — so it is swallowed here too, and reported as "nothing
 * to redeliver" rather than thrown.
 *
 * @returns How many commands were republished.
 */
export async function redeliverOpenCommands(machineId: string): Promise<number> {
  try {
    const machine = (await prisma.machine.findFirst({
      where: { id: machineId },
      select: { id: true, tenantId: true, siteId: true },
    })) as MachineIdentity | null;

    if (!machine?.tenantId || !machine.siteId) return 0;

    const open = (await prisma.machineCommand.findMany({
      where: { machineId, status: "pending", expiresAt: { gt: new Date() } },
      select: { commandId: true, type: true, payload: true },
      orderBy: { issuedAt: "asc" },
    })) as { commandId: string; type: string; payload: Record<string, unknown> }[];

    for (const command of open) {
      await publishCommand(machine, { type: command.type, ...command.payload }, command.commandId);
    }

    return open.length;
  } catch (error) {
    console.warn(`mqtt: could not redeliver open commands for machine ${machineId}:`, error);
    return 0;
  }
}
