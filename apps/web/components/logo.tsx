import Image from "next/image";
import Link from "next/link";

export function Brand() {
  return (
    <Link className="brand" href="/" aria-label="Telic home">
      <span className="brand-mark" aria-hidden="true">
        <Image
          alt=""
          height={26}
          sizes="24px"
          src="/telic-logo.png"
          width={24}
        />
      </span>
      <span className="brand-wordmark">TELIC</span>
    </Link>
  );
}
