"""Testes do PrenotaBot Livre (rodam sem Chrome e sem internet).

Rodar:  python -m unittest discover -s tests -v
"""
import sys
import tempfile
import unittest
from datetime import datetime
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import core  # noqa: E402


class FakeOption:
    def __init__(self, text, value):
        self.text, self._value = text, value

    def get_attribute(self, name):
        return self._value if name == "value" else None


class FakeElement:
    def __init__(self, text="", displayed=True):
        self.text, self._displayed, self.clicked = text, displayed, False

    def is_displayed(self):
        return self._displayed

    def click(self):
        self.clicked = True


class FakeDriver:
    """Simula o Chrome: url, titulo, elementos por ID e texto da pagina."""

    def __init__(self, url="https://prenotami.esteri.it/Services/Booking/5402", title="", ids=(), body="",
                 dialog=False):
        self.current_url, self.title, self.ids, self.body = url, title, set(ids), body
        self.dialog = FakeElement("Al momento non ci sono date disponibili") if dialog else None

    def find_elements(self, by, value):
        if by == "id":
            return [FakeElement()] if value in self.ids else []
        if by == "xpath" and "dialog" in value:
            return [self.dialog] if self.dialog else []
        return []

    def find_element(self, by, value):
        if by == "tag name":
            return FakeElement(self.body)
        raise core.WebDriverException("nao encontrado")


def make_bot(driver):
    bot = core.PrenotaBot(dict(core.DEFAULT_CONFIG), {}, ui=core.ConsoleUI())
    bot.driver = driver
    return bot


class TestUtilidades(unittest.TestCase):
    def test_normalize(self):
        self.assertEqual(core.normalize("  Endereço   COMPLETO "), "endereco completo")
        self.assertEqual(core.normalize(None), "")

    def test_classify_label(self):
        self.assertEqual(core.classify_label("Indirizzo di residenza"), "endereco")
        self.assertEqual(core.classify_label("Endereço completo"), "endereco")

    def test_code_for(self):
        self.assertEqual(core.code_for("estado_civil", "Solteiro/a"), "16")
        self.assertEqual(core.code_for("estado_civil", "Casado"), "13")
        self.assertEqual(core.code_for("cor_olhos", "Castanho"), "23")
        self.assertEqual(core.code_for("filhos_menores", "Não"), "12")
        self.assertIsNone(core.code_for("cor_olhos", "roxo"))

    def test_parse_date(self):
        self.assertEqual(str(core.parse_date("05/03/2027")), "2027-03-05")
        self.assertEqual(str(core.parse_date("2027-03-05")), "2027-03-05")
        self.assertIsNone(core.parse_date("ontem"))

    def test_presets_sao_paulo(self):
        self.assertIn(5402, core.SERVICE_PRESETS)
        campos = core.SERVICE_PRESETS[5402]["campos"]
        self.assertEqual(campos["DatiAddizionaliPrenotante[0]._testo"], "endereco")
        self.assertEqual(campos["ddls_1"], "estado_civil")
        self.assertEqual(campos["ddls_3"], "cor_olhos")


class TestJanelaHorario(unittest.TestCase):
    def test_sem_janela(self):
        self.assertEqual(core.in_time_window({}), (True, 0))

    def test_dentro_e_fora(self):
        cfg = {"janela_horario": "09:00-12:00"}
        self.assertEqual(core.in_time_window(cfg, datetime(2026, 11, 23, 10, 0)), (True, 0))
        ok, falta = core.in_time_window(cfg, datetime(2026, 11, 23, 7, 0))
        self.assertFalse(ok)
        self.assertAlmostEqual(falta, 2 * 3600)

    def test_dias_semana(self):
        ok, falta = core.in_time_window({"dias_semana": [3]}, datetime(2026, 11, 23, 10, 0))  # segunda
        self.assertFalse(ok)
        self.assertGreater(falta, 0)


class TestSelect(unittest.TestCase):
    def _sel(self, options):
        fake = mock.MagicMock()
        fake.options = [FakeOption(t, v) for t, v in options]
        return fake

    def test_select_por_sinonimo(self):
        fake = self._sel([("", ""), ("Si", "11"), ("No", "12")])
        with mock.patch.object(core, "Select", return_value=fake):
            self.assertTrue(core.select_option(mock.MagicMock(), "Sim"))
            fake.select_by_visible_text.assert_called_with("Si")

    def test_select_parcial(self):
        fake = self._sel([("Celibe/Nubile (Solteiro/a)", "16"), ("Coniugato/a (Casado/a)", "13")])
        with mock.patch.object(core, "Select", return_value=fake):
            self.assertTrue(core.select_option(mock.MagicMock(), "casado/a"))
            fake.select_by_visible_text.assert_called_with("Coniugato/a (Casado/a)")

    def test_select_nao_encontra(self):
        fake = self._sel([("A", "1"), ("B", "2")])
        with mock.patch.object(core, "Select", return_value=fake):
            self.assertFalse(core.select_option(mock.MagicMock(), "xyz"))


class TestDisponibilidade(unittest.TestCase):
    def test_captcha(self):
        bot = make_bot(FakeDriver(url="https://validate.perfdrive.com/abc"))
        self.assertEqual(bot.check_availability(timeout=2), "captcha")

    def test_bloqueado(self):
        bot = make_bot(FakeDriver(url="https://prenotami.esteri.it/Error?cid=1"))
        self.assertEqual(bot.check_availability(timeout=2), "bloqueado")

    def test_calendario(self):
        bot = make_bot(FakeDriver(url="https://prenotami.esteri.it/BookingCalendar?selectedService=5402"))
        self.assertEqual(bot.check_availability(timeout=2), "calendario")

    def test_disponivel(self):
        bot = make_bot(FakeDriver(ids={"typeofbookingddl"}))
        self.assertEqual(bot.check_availability(timeout=2), "disponivel")

    def test_indisponivel_dialogo(self):
        bot = make_bot(FakeDriver(dialog=True))
        self.assertEqual(bot.check_availability(timeout=2), "indisponivel")

    def test_indisponivel_texto(self):
        bot = make_bot(FakeDriver(body="Al momento non ci sono date disponibili per il servizio richiesto"))
        self.assertEqual(bot.check_availability(timeout=2), "indisponivel")

    def test_deslogado(self):
        bot = make_bot(FakeDriver(ids={"login-email"}))
        self.assertEqual(bot.check_availability(timeout=2), "deslogado")


class TestConfigEPerfis(unittest.TestCase):
    def test_salvar_e_carregar(self):
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp) / "perfil.yaml"
            cfg = dict(core.DEFAULT_CONFIG)
            cfg["servicos"] = [5402, "abc"]
            cfg["intervalo_min_segundos"] = 5  # abaixo do minimo
            core.save_config(cfg, p)
            back = core.load_config(p)
            self.assertEqual(back["servicos"], [5402])
            self.assertGreaterEqual(back["intervalo_min_segundos"], 20)

    def test_profile_path_seguro(self):
        p = core.profile_path("../meu perfil!")
        self.assertEqual(p.name, "meu_perfil.yaml")
        self.assertEqual(p.parent, core.PROFILES_DIR)


class TestAvisosEHistorico(unittest.TestCase):
    def test_notify_sem_canais(self):
        r = core.notify({}, "teste")
        self.assertTrue(all(v == "off" for v in r.values()))

    def test_notify_ntfy(self):
        with mock.patch.object(core, "_http") as http:
            r = core.notify({"NTFY_TOPICO": "meu-topico"}, "vaga!")
            self.assertEqual(r["celular (ntfy)"], "ok")
            self.assertEqual(http.call_args[0][0], "https://ntfy.sh/meu-topico")

    def test_history_summary(self):
        with tempfile.TemporaryDirectory() as tmp:
            csv = Path(tmp) / "h.csv"
            csv.write_text("data_hora;dia_semana;servico;resultado\n"
                           "2026-11-23 09:15:00;1;5402;indisponivel\n"
                           "2026-11-23 10:02:00;1;5402;disponivel\n", encoding="utf-8")
            with mock.patch.object(core, "HISTORY_CSV", csv):
                s = core.history_summary()
            self.assertEqual((s["total"], s["vagas"], s["horas_com_vaga"]), (2, 1, {"10": 1}))


if __name__ == "__main__":
    unittest.main()
