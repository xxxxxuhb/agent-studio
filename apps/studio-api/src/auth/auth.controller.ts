import { Body, Controller, Get, Post } from "@nestjs/common";
import { AuthService } from "./auth.service";
import { CurrentUser, type RequestUser } from "./current-user.decorator";
import { Public } from "./public.decorator";

@Controller("auth")
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post("login")
  login(@Body() body: unknown) {
    return this.auth.login(body);
  }

  @Public()
  @Post("register")
  register(@Body() body: unknown) {
    return this.auth.register(body);
  }

  @Get("me")
  me(@CurrentUser() user: RequestUser) {
    return this.auth.me(user.id);
  }
}
