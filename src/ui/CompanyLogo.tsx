import { Icon } from './icons';

export const COMPANY_LOGOS = [
  { id: 'anchor', name: '닻', icon: 'anchor', ink: '#1e4057', paper: '#b8e0e8' },
  { id: 'compass', name: '나침반', icon: 'compass', ink: '#49351c', paper: '#f4cd82' },
  { id: 'sail', name: '돛단배', icon: 'sailboat', ink: '#153f36', paper: '#a1dcc4' },
  { id: 'beacon', name: '등대', icon: 'building-lighthouse', ink: '#572e2c', paper: '#f2b9a6' },
  { id: 'star', name: '북극성', icon: 'north-star', ink: '#423659', paper: '#cec1ed' },
  { id: 'wave', name: '파도', icon: 'ripple', ink: '#1c395a', paper: '#aacdf3' },
];

export function companyLogo(id?: string) {
  return COMPANY_LOGOS.find((logo) => logo.id === id) ?? COMPANY_LOGOS[0];
}

export function CompanyLogo({ id }: { id?: string }) {
  const logo = companyLogo(id);
  return (
    <span className="company-logo" style={{ backgroundColor: logo.paper, color: logo.ink }} role="img" aria-label={`${logo.name} 로고`}>
      <Icon name={logo.icon} size={22} />
    </span>
  );
}
