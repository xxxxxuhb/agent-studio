import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Post,
  Put,
  Query,
} from "@nestjs/common";
import { CurrentUser, type RequestUser } from "../auth/current-user.decorator";
import { ProjectsService } from "./projects.service";

@Controller("projects")
export class ProjectsController {
  constructor(
    @Inject(ProjectsService) private readonly projects: ProjectsService,
  ) {}

  @Get()
  async list(
    @CurrentUser() user: RequestUser,
    @Query("q") q?: string,
    @Query("enabled") enabled?: string,
    @Query("team_id") team_id?: string,
  ) {
    const items = await this.projects.list(user.id, { q, enabled, team_id });
    return {
      items,
      total: items.length,
      default_clone_root: this.projects.getDefaultReposRoot(),
    };
  }

  @Get(":id")
  get(@CurrentUser() user: RequestUser, @Param("id") id: string) {
    return this.projects.getForUser(user.id, id);
  }

  @Get(":id/catalog")
  catalog(@CurrentUser() user: RequestUser, @Param("id") id: string) {
    return this.projects.catalogForManager(user.id, id);
  }

  @Post()
  create(@CurrentUser() user: RequestUser, @Body() body: unknown) {
    return this.projects.create(user.id, body);
  }

  @Put(":id")
  update(
    @CurrentUser() user: RequestUser,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return this.projects.update(user.id, id, body);
  }

  @Delete(":id")
  remove(@CurrentUser() user: RequestUser, @Param("id") id: string) {
    return this.projects.remove(user.id, id);
  }

  @Post(":id/repos")
  addRepo(
    @CurrentUser() user: RequestUser,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return this.projects.addRepo(user.id, id, body);
  }

  @Delete(":id/repos/:repoId")
  removeRepo(
    @CurrentUser() user: RequestUser,
    @Param("id") id: string,
    @Param("repoId") repoId: string,
  ) {
    return this.projects.removeRepo(user.id, id, repoId);
  }

  @Post(":id/clone")
  clone(
    @CurrentUser() user: RequestUser,
    @Param("id") id: string,
    @Body() body: { repo_ids?: string[] },
  ) {
    return this.projects.ensureCloned(user.id, id, body?.repo_ids);
  }
}
