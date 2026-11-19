// Keys & settings for the client: bring your own provider keys, models and limits.
import { getContext, settingsView } from '@pratapai/content-pipeline';
import { PageHead } from '@/app/content/_components/viz';
import { SettingsForm } from '../system/SettingsForm';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const settings = await settingsView((await getContext()).db);
  return <>
    <PageHead title="Keys & settings" sub="Paste your own API keys. Saved keys stay hidden and apply right away." />
    <SettingsForm fields={settings.fields} ready={settings.ready} open />
  </>;
}
