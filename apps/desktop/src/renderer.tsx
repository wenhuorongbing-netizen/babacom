import { createRoot } from 'react-dom/client';
import { AdmissionPage } from './shell/AdmissionPage';
import './styles/tokens.css';

const root = document.getElementById('root');
if (!root) throw new Error('Missing application root');
createRoot(root).render(<AdmissionPage />);
