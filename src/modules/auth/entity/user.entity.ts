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
