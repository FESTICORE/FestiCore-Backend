import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('refresh_tokens')
export class RefreshToken {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index('IDX_refresh_tokens_user_id')
  @Column({ type: 'uuid' })
  userId!: string;

  // refresh 토큰 원문은 저장하지 않고 sha256 해시만 보관.
  // consume() 조회의 핫패스라 unique 인덱스로 O(log n) 조회를 보장한다.
  @Index('IDX_refresh_tokens_token_hash', { unique: true })
  @Column({ type: 'varchar' })
  tokenHash!: string;

  @Column({ type: 'timestamptz' })
  expiresAt!: Date;

  @Column({ type: 'timestamptz', nullable: true })
  revokedAt!: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
