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
import { ProjectsService } from "./projects.service";

@Controller("projects")
export class ProjectsController {
  constructor(
    @Inject(ProjectsService) private readonly projects: ProjectsService,
  ) {}

  @Get()
  list(
    @Query("q") q?: string,
    @Query("enabled") enabled?: string,
  ) {
    const items = this.projects.list({ q, enabled });
    return {
      items,
      total: items.length,
      default_clone_root: this.projects.getDefaultReposRoot(),
    };
  }

  @Get(":id")
  get(@Param("id") id: string) {
    return this.projects.get(id);
  }

  @Get(":id/catalog")
  catalog(@Param("id") id: string) {
    return this.projects.catalogForManager(id);
  }

  @Post()
  create(@Body() body: unknown) {
    return this.projects.create(body);
  }

  @Put(":id")
  update(@Param("id") id: string, @Body() body: unknown) {
    return this.projects.update(id, body);
  }

  @Delete(":id")
  remove(@Param("id") id: string) {
    return this.projects.remove(id);
  }

  @Post(":id/repos")
  addRepo(@Param("id") id: string, @Body() body: unknown) {
    return this.projects.addRepo(id, body);
  }

  @Delete(":id/repos/:repoId")
  removeRepo(@Param("id") id: string, @Param("repoId") repoId: string) {
    return this.projects.removeRepo(id, repoId);
  }

  /** Clone missing repos; skip when local path already has .git */
  @Post(":id/clone")
  clone(
    @Param("id") id: string,
    @Body() body: { repo_ids?: string[] },
  ) {
    return this.projects.ensureCloned(id, body?.repo_ids);
  }
}
