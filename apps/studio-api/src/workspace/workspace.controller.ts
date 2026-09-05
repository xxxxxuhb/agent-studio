import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
} from "@nestjs/common";
import { CurrentUser, type RequestUser } from "../auth/current-user.decorator";
import { WorkspaceBrowseService } from "./workspace-browse.service";

@Controller()
export class WorkspaceController {
  constructor(private readonly workspace: WorkspaceBrowseService) {}

  @Get("work-orders/:id/workspace")
  describeWorkOrder(
    @CurrentUser() user: RequestUser,
    @Param("id") id: string,
    @Query("bridge_id") bridgeId?: string,
  ) {
    return this.workspace.describeWorkOrder(user.id, id, bridgeId);
  }

  @Get("work-orders/:id/workspace/tree")
  treeWorkOrder(
    @CurrentUser() user: RequestUser,
    @Param("id") id: string,
    @Query("repo_id") repo_id?: string,
    @Query("path") path?: string,
    @Query("bridge_id") bridge_id?: string,
  ) {
    return this.workspace.treeWorkOrder(user.id, id, {
      repo_id,
      path,
      bridge_id,
    });
  }

  @Get("work-orders/:id/workspace/file")
  fileWorkOrder(
    @CurrentUser() user: RequestUser,
    @Param("id") id: string,
    @Query("repo_id") repo_id?: string,
    @Query("path") path?: string,
    @Query("bridge_id") bridge_id?: string,
  ) {
    return this.workspace.fileWorkOrder(user.id, id, {
      repo_id,
      path,
      bridge_id,
    });
  }

  @Post("work-orders/:id/workspace/prepare")
  prepareWorkOrder(
    @CurrentUser() user: RequestUser,
    @Param("id") id: string,
    @Body() body: { bridge_id?: string },
  ) {
    return this.workspace.prepareWorkOrder(user.id, id, body?.bridge_id);
  }

  @Get("projects/:id/workspace")
  describeProject(
    @CurrentUser() user: RequestUser,
    @Param("id") id: string,
    @Query("bridge_id") bridgeId?: string,
  ) {
    return this.workspace.describeProject(user.id, id, bridgeId);
  }

  @Get("projects/:id/workspace/tree")
  treeProject(
    @CurrentUser() user: RequestUser,
    @Param("id") id: string,
    @Query("repo_id") repo_id?: string,
    @Query("path") path?: string,
    @Query("bridge_id") bridge_id?: string,
  ) {
    return this.workspace.treeProject(user.id, id, {
      repo_id,
      path,
      bridge_id,
    });
  }

  @Get("projects/:id/workspace/file")
  fileProject(
    @CurrentUser() user: RequestUser,
    @Param("id") id: string,
    @Query("repo_id") repo_id?: string,
    @Query("path") path?: string,
    @Query("bridge_id") bridge_id?: string,
  ) {
    return this.workspace.fileProject(user.id, id, {
      repo_id,
      path,
      bridge_id,
    });
  }

  @Post("projects/:id/workspace/prepare")
  prepareProject(
    @CurrentUser() user: RequestUser,
    @Param("id") id: string,
    @Body() body: { bridge_id?: string },
  ) {
    return this.workspace.prepareProject(user.id, id, {
      bridgeId: body?.bridge_id,
    });
  }
}
