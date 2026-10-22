import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity('web_oauth_states')
export class WebOauthState {
  @PrimaryColumn({ type: 'varchar', length: 64 })
  stateHash!: string;

  @Column({ type: 'varchar', length: 64 })
  browserHash!: string;

  @Column({ type: 'varchar', length: 16 })
  provider!: 'google' | 'apple';

  @Column({ type: 'varchar', length: 64 })
  nonce!: string;

  @Column({ type: 'timestamptz' })
  expiresAt!: Date;

  @Column({ type: 'timestamptz', nullable: true })
  consumedAt!: Date | null;
}

@Entity('web_oauth_tickets')
export class WebOauthTicket {
  @PrimaryColumn({ type: 'varchar', length: 64 })
  ticketHash!: string;

  @Column({ type: 'uuid' })
  userId!: string;

  @Column({ type: 'boolean' })
  newUser!: boolean;

  @Column({ type: 'timestamptz' })
  expiresAt!: Date;

  @Column({ type: 'timestamptz', nullable: true })
  consumedAt!: Date | null;
}
