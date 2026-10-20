import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

@Entity('user_schedules')
export class UserSchedule {
  @PrimaryColumn({ type: 'uuid' })
  userId!: string;

  @PrimaryColumn({ type: 'varchar', length: 32 })
  festivalId!: string;

  @Column({ type: 'jsonb' })
  setIds!: string[];

  @Column({ type: 'timestamptz' })
  clientAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
