// Variáveis de ambiente dos testes. Importe ANTES de qualquer módulo do servidor.
process.env.NODE_ENV = 'test';
process.env.DISABLE_SCHEDULER = '1';
process.env.DISABLE_BACKUP = '1';
process.env.APP_URL = 'https://agenda.teste.local';
process.env.APP_TIMEZONE = 'America/Cuiaba';
process.env.SUPERVISOR_NAME = 'Supervisor Teste';
process.env.SUPERVISOR_EMAIL = 'supervisor@teste.local';
process.env.SUPERVISOR_INITIAL_PASSWORD = 'Inicial-Super-2026';
process.env.COORDINATOR_NAME = 'Coordenador Teste';
process.env.COORDINATOR_EMAIL = 'coordenador@teste.local';
process.env.COORDINATOR_INITIAL_PASSWORD = 'Inicial-Coord-2026';
process.env.LINK_SIGNING_SECRET = 'segredo-de-teste-para-assinar-botoes';
process.env.CRON_SECRET = 'segredo-cron-de-teste';
process.env.ATTACHMENTS_DIR = `${process.env.TMPDIR ?? '/tmp'}/asa-testes-anexos-${process.pid}`;
// Credenciais do WhatsApp começam vazias: cada teste liga o que precisa.
for (const k of ['WHATSAPP_ACCESS_TOKEN', 'WHATSAPP_APP_SECRET', 'WHATSAPP_VERIFY_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID', 'WHATSAPP_BUSINESS_ACCOUNT_ID']) process.env[k] = '';
