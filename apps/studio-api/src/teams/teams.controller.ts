import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from "@nestjs/common";
import { AuthRegisterSchema } from "@agent-studio/agent-schema";
import { AuthService } from "../auth/auth.service";
import { CurrentUser, type RequestUser } from "../auth/current-user.decorator";
import { TeamsService } from "./teams.service";

@Controller("teams")
export class TeamsController {
  constructor(
    private readonly teams: TeamsService,
    private readonly auth: AuthService,
  ) {}

  /**
   * Default: teams the user belongs to (for workspace selection).
   * `?scope=all` — system admin lists every team for configuration.
   */
  @Get()
  async list(
    @CurrentUser() user: RequestUser,
    @Query("scope") scope?: string,
  ) {
    const items =
      scope === "all"
        ? await this.teams.listAllForAdmin(user.id)
        : await this.teams.listForUser(user.id);
    return { items, total: items.length };
  }

  @Post()
  create(@CurrentUser() user: RequestUser, @Body() body: unknown) {
    return this.teams.create(user.id, body);
  }

  /** Admin: create a Studio login so they can be added to a team. */
  @Post("users")
  async createUser(
    @CurrentUser() user: RequestUser,
    @Body() body: unknown,
  ) {
    const parsed = AuthRegisterSchema.parse(body);
    const created = await this.teams.createUserAccount(user.id, parsed);
    return this.auth.toPublic(created);
  }

  @Get(":id")
  get(@CurrentUser() user: RequestUser, @Param("id") id: string) {
    return this.teams.getDetail(id, user.id);
  }

  @Post(":id/members")
  addMember(
    @CurrentUser() user: RequestUser,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return this.teams.addMember(id, user.id, body);
  }

  @Patch(":id/members/:userId")
  updateMember(
    @CurrentUser() user: RequestUser,
    @Param("id") id: string,
    @Param("userId") userId: string,
    @Body() body: unknown,
  ) {
    return this.teams.updateMember(id, user.id, userId, body);
  }

  @Delete(":id/members/:userId")
  removeMember(
    @CurrentUser() user: RequestUser,
    @Param("id") id: string,
    @Param("userId") userId: string,
  ) {
    return this.teams.removeMember(id, user.id, userId);
  }
}
