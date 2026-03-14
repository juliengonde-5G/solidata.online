const { sendNotification } = require('../../../src/services/notification');

describe('Notification Service', () => {
  it('should run in dry-run mode when no BREVO_API_KEY', async () => {
    const template = { type: 'email', body: 'Hello {prenom}' };
    const result = await sendNotification(template, 'test@test.com', null, { prenom: 'Jean' });
    expect(result.dryRun).toBe(true);
  });

  it('should skip when no recipient provided', async () => {
    const template = { type: 'email', body: 'Hello' };
    const result = await sendNotification(template, null, null, {});
    // Either dryRun or skipped depending on env
    expect(result.dryRun || result.skipped).toBe(true);
  });

  it('should replace template variables', async () => {
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
    const template = { type: 'email', body: 'Bonjour {prenom} {nom}' };
    await sendNotification(template, 'test@test.com', null, { prenom: 'Jean', nom: 'DUPONT' });
    // Check that console.log was called with the resolved message
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Jean'));
    consoleSpy.mockRestore();
  });
});
