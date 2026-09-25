// Плитки главной: задача («Різати метал») и группа каталога («Диски та круги»).
import Image from "next/image";
import Link from "next/link";
import { Icon } from "./icons";

export function TaskTile({ href, icon, name, hint, count }: { href: string; icon: string; name: string; hint: string; count: string }) {
  return (
    <Link className="hm-task" href={href}>
      <span className="hm-task-icon"><Icon name={icon} size={28} /></span>
      <span className="hm-task-name">{name}</span>
      {hint && <span className="hm-task-hint">{hint}</span>}
      <span className="hm-task-count">{count}</span>
    </Link>
  );
}

export function GroupTile({ href, image, name, count }: { href: string; image: string | null; name: string; count: string }) {
  return (
    <Link className="hm-group" href={href}>
      <span className="hm-group-img">
        {image && <Image src={image} alt="" fill sizes="(max-width: 699px) 45vw, (max-width: 999px) 22vw, 200px" />}
      </span>
      <span className="hm-group-name">{name}</span>
      <span className="hm-group-count">{count}</span>
    </Link>
  );
}
