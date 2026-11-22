import { canCarry, isDocked, PLAYER_ID } from './player';
import type { CargoLot, CompanyWarehouse, EconomyContext, EconomyState, Ship, StorageZone } from './types';

export const WAREHOUSE_RULES = {
  capacity: 180,
  coldCapacity: 60,
  coldBuildCost: 8000,
  feePerVolume: 0.4,
  coldFeePerVolume: 0.8,
} as const;

export function createWarehouse(cityId: string): CompanyWarehouse {
  return { cityId, capacity: WAREHOUSE_RULES.capacity, coldCapacity: 0, cargo: [], coldCargo: [] };
}

/** 읽기만 해도 예전 저장의 상태가 바뀌지는 않는다. */
export function warehouseOf(ctx: EconomyContext, state: EconomyState): CompanyWarehouse {
  return state.player.warehouse ?? createWarehouse(ctx.data.player.startCityId);
}

export const storedLots = (warehouse: CompanyWarehouse, zone: StorageZone): CargoLot[] => zone === 'cold' ? warehouse.coldCargo : warehouse.cargo;
export const storageCapacity = (warehouse: CompanyWarehouse, zone: StorageZone): number => zone === 'cold' ? warehouse.coldCapacity : warehouse.capacity;
export const lotVolume = (ctx: EconomyContext, lots: CargoLot[]): number => lots.reduce((v, l) => v + l.quantity * ctx.goodById[l.goodId].volume, 0);
export const lotQuantity = (lots: CargoLot[], goodId: string): number => lots.reduce((q, l) => q + (l.goodId === goodId ? l.quantity : 0), 0);

export function warehouseMonthlyFee(ctx: EconomyContext, warehouse: CompanyWarehouse): number {
  return lotVolume(ctx, warehouse.cargo) * WAREHOUSE_RULES.feePerVolume + lotVolume(ctx, warehouse.coldCargo) * WAREHOUSE_RULES.coldFeePerVolume;
}

export function warehouseTransferLimit(ctx: EconomyContext, state: EconomyState, ship: Ship, goodId: string, direction: 'store' | 'load', zone: StorageZone): number {
  const warehouse = warehouseOf(ctx, state), g = ctx.goodById[goodId];
  if (!g || ship.companyId !== PLAYER_ID || !isDocked(ship) || ship.routeId || ship.to !== warehouse.cityId) return 0;
  const stored = storedLots(warehouse, zone);
  if (direction === 'store') return Math.max(0, Math.min(lotQuantity(ship.cargo, goodId), (storageCapacity(warehouse, zone) - lotVolume(ctx, stored)) / g.volume));
  if (!canCarry(ctx, ship.typeId, goodId)) return 0;
  return Math.max(0, Math.min(lotQuantity(stored, goodId), (ship.capacity - lotVolume(ctx, ship.cargo)) / g.volume));
}

/** 소유권만 이동. 매입 시점·원가·원산지·상표·처음 산 항구는 그대로 남긴다. */
export function moveLots(from: CargoLot[], to: CargoLot[], goodId: string, quantity: number): void {
  let left = quantity;
  for (const lot of from) {
    if (lot.goodId !== goodId || left <= 0) continue;
    const take = Math.min(lot.quantity, left);
    to.push({ ...structuredClone(lot), quantity: take });
    lot.quantity -= take;
    left -= take;
  }
  for (let i = from.length - 1; i >= 0; i--) if (from[i].quantity <= 1e-9) from.splice(i, 1);
}
