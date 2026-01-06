import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { Validator } from '@/types/validator';
// Local minimal table primitives
function Table(props: React.HTMLAttributes<HTMLTableElement>) {
  return <table className="w-full border-collapse" {...props} />;
}
function TableHeader(props: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <thead className="bg-muted/50" {...props} />;
}
function TableBody(props: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody {...props} />;
}
function TableRow(props: React.HTMLAttributes<HTMLTableRowElement>) {
  return <tr className="border-b border-border" {...props} />;
}
function TableHead(props: React.ThHTMLAttributes<HTMLTableCellElement>) {
  return <th className="text-left p-3 text-xs uppercase text-muted-foreground" {...props} />;
}
function TableCell(props: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className="p-3 align-middle" {...props} />;
}

interface ValidatorListProps {
  validators: Validator[];
}

export default function ValidatorList({ validators }: ValidatorListProps) {
  const getStatusVariant = (status: Validator['status']) => {
    switch (status) {
      case 'active':
        return 'default';
      case 'inactive':
        return 'destructive';
      case 'pending':
        return 'secondary';
      case 'exited':
        return 'outline';
    }
  };

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Index</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Balance</TableHead>
            <TableHead>Performance</TableHead>
            <TableHead>Missed</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {validators.map((validator) => (
            <TableRow key={validator.id}>
              <TableCell className="font-mono text-sm">{validator.index}</TableCell>
              <TableCell>
                <Badge variant={getStatusVariant(validator.status)}>{validator.status}</Badge>
              </TableCell>
              <TableCell className="font-display">{validator.balance.toFixed(2)} GNO</TableCell>
              <TableCell>
                <span
                  className={cn(
                    'font-display',
                    validator.performance >= 99
                      ? 'text-success'
                      : validator.performance >= 95
                        ? 'text-warning'
                        : 'text-destructive',
                  )}
                >
                  {validator.performance.toFixed(1)}%
                </span>
              </TableCell>
              <TableCell className="font-mono text-sm">{validator.missedAttestations}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
