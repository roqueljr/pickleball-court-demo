import { useAuth } from "../auth/AuthProvider";
import { CustomerGrowth } from "./growth/CustomerGrowth";
import { OwnerGrowth } from "./growth/OwnerGrowth";

export function Growth() {
  const { user } = useAuth();
  const isOperations = user?.roles.some((role) => ["SUPER_ADMIN", "ADMIN", "STAFF"].includes(role)) ?? false;
  return isOperations ? <OwnerGrowth isAdmin={user?.roles.some((role) => ["SUPER_ADMIN", "ADMIN"].includes(role)) ?? false} /> : <CustomerGrowth />;
}
