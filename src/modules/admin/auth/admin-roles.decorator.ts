import { SetMetadata } from '@nestjs/common';

export type AdminRole = 'viewer' | 'editor' | 'owner';
export const ADMIN_ROLES_KEY = 'adminRoles';

export const AdminRoles = (...roles: AdminRole[]) =>
  SetMetadata(ADMIN_ROLES_KEY, roles);

export const AdminRole = (role: AdminRole) => AdminRoles(role);
