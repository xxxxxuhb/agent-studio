import type { ReactNode } from "react";
import { Button, Typography } from "antd";

type Props = {
  icon: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
};

/** Illustrated empty state for master-detail panes. */
export function EmptyRich({ icon, title, description, action }: Props) {
  return (
    <div className="empty-rich">
      <div className="empty-rich__icon">{icon}</div>
      <div className="empty-rich__title">{title}</div>
      {description ? (
        <Typography.Paragraph className="empty-rich__desc" style={{ marginBottom: 0 }}>
          {description}
        </Typography.Paragraph>
      ) : null}
      {action ? <div style={{ marginTop: 8 }}>{action}</div> : null}
    </div>
  );
}

export function EmptyRichActionButton(props: {
  children: ReactNode;
  onClick?: () => void;
  icon?: ReactNode;
}) {
  return (
    <Button type="primary" icon={props.icon} onClick={props.onClick}>
      {props.children}
    </Button>
  );
}
