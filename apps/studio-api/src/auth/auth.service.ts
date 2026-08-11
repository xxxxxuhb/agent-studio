import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { InjectRepository } from "@nestjs/typeorm";
import { randomUUID } from "node:crypto";
import * as bcrypt from "bcryptjs";
import { Repository } from "typeorm";
import {
  AuthLoginSchema,
  AuthRegisterSchema,
  type AuthLoginResponse,
  type AuthUserPublic,
} from "@agent-studio/agent-schema";
import { UserEntity } from "./entities/user.entity";

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(UserEntity)
    private readonly users: Repository<UserEntity>,
    private readonly jwt: JwtService,
  ) {}

  toPublic(user: UserEntity): AuthUserPublic {
    return {
      id: user.id,
      username: user.username,
      display_name: user.display_name || "",
      is_admin: Boolean(user.is_admin),
    };
  }

  async countUsers(): Promise<number> {
    return this.users.count();
  }

  async findByUsername(username: string): Promise<UserEntity | null> {
    return this.users.findOne({ where: { username } });
  }

  async findById(id: string): Promise<UserEntity | null> {
    return this.users.findOne({ where: { id } });
  }

  async createUser(input: {
    username: string;
    password: string;
    display_name?: string;
    is_admin?: boolean;
  }): Promise<UserEntity> {
    const existing = await this.findByUsername(input.username);
    if (existing) {
      throw new ConflictException(`username already exists: ${input.username}`);
    }
    const user = this.users.create({
      id: randomUUID(),
      username: input.username,
      password_hash: await bcrypt.hash(input.password, 10),
      display_name: (input.display_name || "").trim() || input.username,
      is_admin: Boolean(input.is_admin),
    });
    return this.users.save(user);
  }

  async ensureAdminFlag(user: UserEntity): Promise<UserEntity> {
    if (user.is_admin) return user;
    user.is_admin = true;
    return this.users.save(user);
  }

  signToken(user: UserEntity): string {
    return this.jwt.sign({
      sub: user.id,
      username: user.username,
      display_name: user.display_name || "",
      is_admin: Boolean(user.is_admin),
    });
  }

  async login(input: unknown): Promise<AuthLoginResponse> {
    const body = AuthLoginSchema.parse(input);
    const user = await this.findByUsername(body.username);
    if (!user) throw new UnauthorizedException("用户名或密码错误");
    const ok = await bcrypt.compare(body.password, user.password_hash);
    if (!ok) throw new UnauthorizedException("用户名或密码错误");
    return {
      token: this.signToken(user),
      user: this.toPublic(user),
    };
  }

  /**
   * Open only when the user table is empty (bootstrap).
   * First registered user becomes system admin.
   */
  async register(input: unknown): Promise<AuthLoginResponse> {
    const count = await this.countUsers();
    if (count > 0) {
      throw new BadRequestException(
        "公开注册已关闭；请联系系统管理员创建账号并加入团队",
      );
    }
    const body = AuthRegisterSchema.parse(input);
    const user = await this.createUser({ ...body, is_admin: true });
    return {
      token: this.signToken(user),
      user: this.toPublic(user),
    };
  }

  async me(userId: string): Promise<AuthUserPublic> {
    const user = await this.findById(userId);
    if (!user) throw new UnauthorizedException("user not found");
    return this.toPublic(user);
  }

  async assertAdmin(userId: string): Promise<UserEntity> {
    const user = await this.findById(userId);
    if (!user) throw new UnauthorizedException("user not found");
    if (!user.is_admin) {
      throw new ForbiddenException("仅系统管理员可配置团队");
    }
    return user;
  }
}
