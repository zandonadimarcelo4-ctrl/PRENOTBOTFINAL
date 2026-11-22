"""
PrenotaBot Livre - modo terminal.

    python main.py                    # monitora usando o ultimo perfil salvo
    python main.py --perfil cuiaba    # usa perfis/cuiaba.yaml
    python main.py --listar           # lista os servicos (IDs) da sua conta
    python main.py --verificar        # so confere configuracao e documentos
    python main.py --testar-avisos    # envia um aviso de teste em todos os canais

Para a interface grafica use painel.pyw (ou iniciar.bat).
"""
import argparse
import sys

import core


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="PrenotaBot Livre")
    ap.add_argument("--perfil", help="nome do perfil em perfis/ (padrao: ultimo usado)")
    ap.add_argument("--listar", action="store_true", help="lista os servicos da conta")
    ap.add_argument("--verificar", action="store_true", help="valida a configuracao")
    ap.add_argument("--testar-avisos", action="store_true", help="envia um aviso de teste")
    args = ap.parse_args(argv)

    core.setup_logging()
    env = core.load_env()
    last = core.PROFILES_DIR / "_ultimo.txt"
    name = args.perfil or (last.read_text(encoding="utf-8").strip() if last.exists() else "")
    path = core.profile_path(name) if name else core.CONFIG_PATH
    if not path.exists():
        path = core.CONFIG_PATH
    cfg = core.load_config(path)
    core.log.info(f"Configuracao: {path.name}")

    if args.testar_avisos:
        for canal, r in core.notify(env, "PrenotaBot: teste de aviso.").items():
            core.log.info(f"  {canal}: {r}")
        return 0
    probs = core.preflight(cfg, env)
    for p in probs:
        core.log.warning(p)
    if args.verificar:
        core.log.info("Verificacao concluida." if not probs else "Corrija os itens acima.")
        return 0 if not [p for p in probs if p.startswith("Documento")] else 1
    bot = core.PrenotaBot(cfg, env)
    try:
        return bot.run(only_discover=args.listar)
    finally:
        bot.quit()


if __name__ == "__main__":
    sys.exit(main())
