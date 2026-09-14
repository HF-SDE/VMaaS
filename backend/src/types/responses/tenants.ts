import { getMembersService } from "@/api/services/tenants.service";

export type MembersResponse = Awaited<ReturnType<typeof getMembersService>>[number];
