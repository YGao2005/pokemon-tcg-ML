import { Request, Response } from 'express';
import { AuthToken, generateToken } from '../services';
import { Controller, Get, Post } from './controller';
import { ServerConfig } from '../interfaces';
import { config } from '../../config';


export class Login extends Controller {

  @Post('/register')
  public async onRegister(req: Request, res: Response) {
    // Local-only mode: registration is a no-op, user auto-created at startup
    res.send({ok: true});
  }

  @Post('')
  public async onLogin(req: Request, res: Response) {
    // Local-only mode: always succeed and return a token
    const token = generateToken(1);
    res.send({ok: true, token, config: this.getServerConfig()});
  }

  @Get('/refreshToken')
  @AuthToken()
  public async onRefreshToken(req: Request, res: Response) {
    const token = generateToken(1);
    res.send({ok: true, token, config: this.getServerConfig()});
  }

  @Get('/logout')
  @AuthToken()
  public onLogout(req: Request, res: Response) {
    res.send({ok: true});
  }

  @Get('/info')
  public onInfo(req: Request, res: Response) {
    res.send({ok: true, config: this.getServerConfig()});
  }

  private getServerConfig(): ServerConfig {
    return {
      apiVersion: 2,
      defaultPageSize: config.backend.defaultPageSize,
      scansUrl: config.sets.scansUrl,
      avatarsUrl: config.backend.avatarsUrl,
      avatarFileSize: config.backend.avatarFileSize,
      avatarMinSize: config.backend.avatarMinSize,
      avatarMaxSize: config.backend.avatarMaxSize,
      replayFileSize: config.backend.replayFileSize
    };
  }

}
