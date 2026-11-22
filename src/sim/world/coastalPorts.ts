/** 기존 거점마다 붙는 연안 소항구. 지도와 경제 프로필이 같은 항구 목록을 쓴다. */
export const COASTAL_PORTS: Record<string, readonly { id: string; name: string }[]> = {
  portabel: [{ id: 'bellona', name: '벨로나' }, { id: 'rivana', name: '리바나' }],
  nandia: [{ id: 'tamar', name: '타마르' }, { id: 'calina', name: '칼리나' }],
  havenru: [{ id: 'vestin', name: '베스틴' }, { id: 'nordel', name: '노르델' }],
  granbel: [{ id: 'brisen', name: '브리센' }, { id: 'estel', name: '에스텔' }],
  lumen: [{ id: 'serin', name: '세린' }, { id: 'avel', name: '아벨' }],
  kelda: [{ id: 'tiren', name: '티렌' }, { id: 'fiora', name: '피오라' }],
  soltia: [{ id: 'palmera', name: '팔메라' }, { id: 'azura', name: '아주라' }],
  maraco: [{ id: 'coral', name: '코랄' }, { id: 'savina', name: '사비나' }],
  orpa: [{ id: 'doren', name: '도렌' }, { id: 'merida', name: '메리다' }],
  draven: [{ id: 'branta', name: '브란타' }, { id: 'ravik', name: '라비크' }],
  mirapo: [{ id: 'neria', name: '네리아' }, { id: 'rosen', name: '로센' }],
  selwyn: [{ id: 'valen', name: '발렌' }, { id: 'iren', name: '이렌' }],
};
