import { useMemo } from 'react';
import { shipThumbnail } from '../render/shipThumb';
import { Icon } from './icons';

/** 내 회사 굴뚝 색(지구본의 내 배와 같다) */
export const PLAYER_FUNNEL = '#ffd166';
/** WebGL을 쓸 수 없을 때 대신 보여 줄 아이콘 */
export const SHIP_ICON: Record<string, string> = { small: 'sailboat-2', medium: 'ship', bulk: 'ship', container: 'box-multiple', reefer: 'snowflake' };

/** 지구본과 같은 로우폴리 배 모델 그림(가로:세로 = 2:1) */
export function ShipPic({ typeId = 'medium', width = 96, funnel = PLAYER_FUNNEL, title }: { typeId?: string; width?: number; funnel?: string; title?: string }) {
  // 큰 그림은 해상도를 높여 찍는다(기본 그림 가로 240px)
  const scale = width > 260 ? 3 : 1;
  const url = useMemo(() => shipThumbnail(typeId, funnel, scale), [typeId, funnel, scale]);
  if (!url) return <Icon name={SHIP_ICON[typeId] ?? 'ship'} size={Math.round(width / 3)} label={title} />;
  return <img className="ship-pic" src={url} width={width} height={width / 2} alt={title ?? ''} title={title} draggable={false} />;
}
