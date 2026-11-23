import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { SocialProvider } from '../types/social-profile';

@Entity('users')
@Index('IDX_users_provider_provider_id', ['provider', 'providerId'], {
  unique: true,
})
export class User {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar' })
  provider!: SocialProvider;

  @Column({ type: 'varchar' })
  providerId!: string;

  @Column({ type: 'varchar', nullable: true })
  email!: string | null;

  @Column({ type: 'varchar', nullable: true })
  nickname!: string | null;

  @Column({ type: 'boolean', default: false })
  nicknameConfirmed!: boolean;

  @Column({ type: 'boolean', default: false })
  nicknameExplicitlySet!: boolean;

  @Column({ type: 'timestamptz', nullable: true })
  termsAcceptedAt!: Date | null;

  @Column({ type: 'varchar', nullable: true })
  termsVersion!: string | null;

  @Column({ type: 'boolean', default: false })
  pushOptIn!: boolean;

  // 계정 단위 기수 모드를 껐다(관객). 소유 깃발의 flags.ownerPaused와 같게 유지한다.
  @Column({ type: 'boolean', default: false })
  bearerModeOff!: boolean;

  // provider가 제공한 프로필 사진 URL.
  @Column({ type: 'varchar', nullable: true })
  profileImageUrl!: string | null;

  // provider(OAuth) refresh 토큰. 회원 탈퇴 시 provider 연동 해제(revoke)에 사용.
  @Column({ type: 'varchar', nullable: true, select: false })
  oauthRefreshToken!: string | null;

  @Column({ type: 'varchar', nullable: true, select: false })
  oauthClientId!: string | null;

  @Column({ type: 'varchar', nullable: true, select: false })
  oauthWebRefreshToken!: string | null;

  @Column({ type: 'varchar', nullable: true, select: false })
  oauthWebClientId!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
