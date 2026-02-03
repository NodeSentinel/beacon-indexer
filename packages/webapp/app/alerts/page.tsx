import DashboardPageLayout from '@/components/dashboard/layout';
import GearIcon from '@/components/icons/gear';
import AlertConfiguration from '@/components/validators/alert-configuration';
import type { ValidatorData } from '@/types/validator';
import validatorMockJson from '@/validator-mock.json';

const validatorData = validatorMockJson as ValidatorData;

export default function AlertsPage() {
  return (
    <DashboardPageLayout
      header={{
        title: 'Alerts',
        description: 'Configure monitoring alerts',
        icon: GearIcon,
      }}
    >
      <AlertConfiguration config={validatorData.alertConfig} />
    </DashboardPageLayout>
  );
}
