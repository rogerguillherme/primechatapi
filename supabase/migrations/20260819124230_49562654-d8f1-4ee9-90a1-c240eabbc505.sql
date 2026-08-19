insert into flow_steps (id, flow_id, step_order, step_type, parent_step_id, delay_minutes, custom_message, buttons)
values
('a1b2c3d4-0005-4000-8000-000000000005','1a4b12e8-c99a-4682-9ab8-5dc99ce7627b',12,'cta_url',null,0,
'Oi, {nome}! Deixa eu te falar uma coisa rapidinho.

Ontem, uma nova geração de nutricionistas tomou uma decisão que vai mudar a carreira deles pra sempre. E eu queria muito te ver nessa também.

Eu e o Dudu Haluch abrimos o Combo da Nova Era da Nutrição, o caminho completo que já passou pela mão de mais de 50 mil alunos, pra transformar você na referência que o paciente procura e disputa.

E olha, isso não é mais um curso pra você acumular aula e nunca assistir. É a formação completa que faltava pra você parar de andar em círculos e finalmente viver bem dessa profissão.

É a sua chance de retomar o protagonismo que roubaram do nutricionista sério, e virar o nutricionista da nova era, que domina a ciência, constrói autoridade e lota a agenda.

Se você tá pronto, é só garantir a sua vaga por aqui 👇',
'[{"id":"c1a11111-0000-4000-8000-000000000001","title":"Garantir Vaga","url":"https://novaeranutricao.com.br/combo/"}]'::jsonb),
('a1b2c3d4-0006-4000-8000-000000000006','1a4b12e8-c99a-4682-9ab8-5dc99ce7627b',13,'cta_url','a1b2c3d4-0005-4000-8000-000000000005',0,
'Ficou com alguma dúvida antes de garantir a sua vaga? Fala direto com um especialista da nossa equipe 👇',
'[{"id":"c1a11111-0000-4000-8000-000000000002","title":"Falar com Suporte","url":"https://api.whatsapp.com/send/?phone=5575981235571&text=Ol%C3%A1%21+Estou+com+d%C3%BAvidas+sobre+o+Combo+da+Nova+Era+da+Nutri%C3%A7%C3%A3o+e+queria+falar+com+um+especialista.&type=phone_number&app_absent=0"}]'::jsonb);