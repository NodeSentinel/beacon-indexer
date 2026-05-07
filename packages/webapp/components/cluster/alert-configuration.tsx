'use client';

import { useState } from 'react';

import DashboardCard from '@/components/dashboard/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import type { AlertConfig } from '@/types/validator';

interface AlertConfigurationProps {
  config: AlertConfig;
}

export default function AlertConfiguration({ config: initialConfig }: AlertConfigurationProps) {
  const [config, setConfig] = useState(initialConfig);

  const handleSave = () => {
    console.log('[v0] Saving alert configuration:', config);
  };

  return (
    <div className="space-y-6 p-6">
      <h2 className="text-2xl font-display">Configure Alerts</h2>

      <DashboardCard title="ALERT TYPES" intent="default">
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="sync-committee" className="text-sm font-medium">
                Sync Committee Participation
              </Label>
              <p className="text-xs text-muted-foreground">
                Get notified when validators are selected for sync committee duties
              </p>
            </div>
            <Switch
              id="sync-committee"
              checked={config.alerts.syncCommitteeParticipation}
              onCheckedChange={(checked) =>
                setConfig({
                  ...config,
                  alerts: { ...config.alerts, syncCommitteeParticipation: checked },
                })
              }
            />
          </div>

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="withdrawals" className="text-sm font-medium">
                Withdrawals
              </Label>
              <p className="text-xs text-muted-foreground">
                Get notified when partial or full withdrawals are processed
              </p>
            </div>
            <Switch
              id="withdrawals"
              checked={config.alerts.withdrawals}
              onCheckedChange={(checked) =>
                setConfig({
                  ...config,
                  alerts: { ...config.alerts, withdrawals: checked },
                })
              }
            />
          </div>

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="block-proposer" className="text-sm font-medium">
                Block Proposer
              </Label>
              <p className="text-xs text-muted-foreground">
                Get notified when validators are selected to propose blocks
              </p>
            </div>
            <Switch
              id="block-proposer"
              checked={config.alerts.blockProposer}
              onCheckedChange={(checked) =>
                setConfig({
                  ...config,
                  alerts: { ...config.alerts, blockProposer: checked },
                })
              }
            />
          </div>
        </div>
      </DashboardCard>

      <DashboardCard title="PERFORMANCE ALERTS" intent="default">
        <div className="space-y-6">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label htmlFor="performance-threshold">Performance Threshold</Label>
              <span className="text-sm font-display text-muted-foreground">
                {config.performanceThreshold}%
              </span>
            </div>
            <Slider
              id="performance-threshold"
              min={90}
              max={100}
              step={0.5}
              value={[config.performanceThreshold]}
              onValueChange={([value]) => setConfig({ ...config, performanceThreshold: value })}
              className="w-full"
            />
            <p className="text-xs text-muted-foreground">
              Alert when validator performance drops below this percentage
            </p>
          </div>
        </div>
      </DashboardCard>

      <DashboardCard title="INACTIVITY ALERTS" intent="default">
        <div className="space-y-6">
          <div className="space-y-3">
            <Label htmlFor="inactivity-slots">Inactivity Threshold (Slots)</Label>
            <Input
              id="inactivity-slots"
              type="number"
              value={config.inactivitySlots}
              onChange={(e) =>
                setConfig({ ...config, inactivitySlots: Number.parseInt(e.target.value) || 0 })
              }
              className="font-mono"
            />
            <p className="text-xs text-muted-foreground">
              Number of consecutive missed slots before marking validator as inactive
            </p>
          </div>
        </div>
      </DashboardCard>

      <DashboardCard title="REWARD ALERTS" intent="success">
        <div className="space-y-6">
          <div className="space-y-3">
            <Label htmlFor="reward-threshold">Reward Accumulation Threshold (GNO)</Label>
            <Input
              id="reward-threshold"
              type="number"
              step="0.01"
              value={config.rewardThreshold}
              onChange={(e) =>
                setConfig({ ...config, rewardThreshold: Number.parseFloat(e.target.value) || 0 })
              }
              className="font-mono"
            />
            <p className="text-xs text-muted-foreground">
              Alert when claimable rewards reach this amount
            </p>
          </div>
        </div>
      </DashboardCard>

      <DashboardCard title="NOTIFICATION FREQUENCY" intent="default">
        <div className="space-y-6">
          <div className="space-y-3">
            <Label htmlFor="alert-frequency">Alert Frequency (Minutes)</Label>
            <Input
              id="alert-frequency"
              type="number"
              value={config.alertFrequency}
              onChange={(e) =>
                setConfig({ ...config, alertFrequency: Number.parseInt(e.target.value) || 0 })
              }
              className="font-mono"
            />
            <p className="text-xs text-muted-foreground">
              Minimum time between repeated alerts for the same issue
            </p>
          </div>

          <div className="grid grid-cols-2 gap-4 pt-4 border-t border-border">
            <div>
              <p className="text-xs text-muted-foreground mb-1">EXAMPLE SCENARIOS</p>
              <ul className="text-xs space-y-1 text-muted-foreground">
                <li>• Validator inactive: Alert every {config.alertFrequency}min</li>
                <li>• Low performance: Alert every {config.alertFrequency}min</li>
                <li>• Rewards ready: Alert once when threshold met</li>
              </ul>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">CURRENT SETTINGS</p>
              <ul className="text-xs space-y-1">
                <li>• Performance: {config.performanceThreshold}%</li>
                <li>• Inactivity: {config.inactivitySlots} slots</li>
                <li>• Rewards: {config.rewardThreshold} GNO</li>
              </ul>
            </div>
          </div>
        </div>
      </DashboardCard>

      <div className="flex justify-end gap-3">
        <Button variant="outline" onClick={() => setConfig(initialConfig)}>
          Reset
        </Button>
        <Button onClick={handleSave}>Save Configuration</Button>
      </div>
    </div>
  );
}
