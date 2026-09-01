type BlogArticleTextSegment = {
  text: string
  strong?: boolean
  emphasis?: boolean
}

type BlogArticleBlock =
  | { type: 'paragraph'; content: BlogArticleTextSegment[] }
  | {
      type: 'list'
      items: BlogArticleTextSegment[][]
      level?: number
      ordered?: boolean
      start?: number
    }
  | { type: 'lineGroup'; lines: BlogArticleTextSegment[][] }
  | { type: 'divider' }
  | { type: 'section'; className: string; blocks: BlogArticleBlock[] }
  | {
      type: 'qaList'
      pairs: { question: BlogArticleTextSegment[]; answer: BlogArticleTextSegment[] }[]
    }

const bt = (text: string): BlogArticleTextSegment => ({ text })
const bs = (text: string): BlogArticleTextSegment => ({ text, strong: true })
const bi = (text: string): BlogArticleTextSegment => ({ text, emphasis: true })

export const blogArticleNeedBetterQuestionsPl: BlogArticleBlock[] = [
  {
    type: 'paragraph',
    content: [bt('Z czym przychodzą do inżynierów szefowie projektu? Najcześciej z:')],
  },
  {
    type: 'list',
    items: [
      [bs('Problemem'), bt(' jaki zidentyfikował klient (zewnętrzny lub wewnętrzny),')],
      [bs('Nieprecyzyjnym opisem'), bt(' sytuacji')],
      [
        bt('Oczekiwaniem znalezienia alternatywnego '),
        bs('rozwiązania'),
        bt(', które będzie tańsze bez utraty lub z dodatkową funkcjonalnością,'),
      ],
      [
        bt('Pytaniem jak coś '),
        bs('przetestować'),
        bt(', żeby móc odpowiedzieć na pytanie/wątpliwość klienta.'),
      ],
    ],
  },
  {
    type: 'paragraph',
    content: [bt('Czego szefowie projektu oczekują od inżynierów?')],
  },
  {
    type: 'list',
    items: [
      [
        bs('Conajmniej kilku pomysłów'),
        bt(' - chcą mieć alternatywę i możliwość wyboru z kilku opcji. Sytuacja w której mają tylko jedno dostępne rozwiązanie nie jest komfortowa, ponieważ nie daje poczucia wyboru optymalnego rozwiązania. Wręcz przeciwnie. Przedstawienie jedynej możliwej drogi rodzi podejrzenie, że jest to nieefektywne rozwiązanie. I trudno z tym dyskutować skoro nie można go z niczym porównać.'),
      ],
      [
        bs('Szybkiej informacji zwrotnej'),
        bt(' - w sytuacji, w której na odpowiedź czeka klient, cierpliwość jest zasobem rzadkim. Każdy okres czasu podany jako niezbędny i konieczny do przygotowania wartościowej odpowiedzi wydaje się z perspektywy klienta zbyt długi. Jeżeli dodamy do tego efekt globalnego rynku i konkurencji z rynkiem azjatyckim, który jest - niebezpodstawnie - postrzegany w zestawieniu z rynkiem europejskim i amerykańskim jako znacznie bardziej dynamiczny, to wymaganie szybkiej odpowiedzi nabiera jeszcze większego znaczenia.'),
      ],
      [
        bs('Planu akcji '),
        bt('- przedstawienie kilku pomysłów w relatywnie krótkim czasie, bez podania conajmniej kilku najbliższych kroków, które zmierzają do finalnego rozwiązania też nie jest odpowiedzią na potrzebę szefa projektu. To dobry początek ale bez planu realizacji szef projektu  często nie potrafi ocenić jakości pomysłów, nie wiedząc jak mają być zweryfikowane lub też nie widząc pierwszych wizualizacji rozwiązania.'),
      ],
    ],
  },
  {
    type: 'paragraph',
    content: [bt('W jakiej sytuacji stawia to inżynierów?')],
  },
  {
    type: 'list',
    items: [
      [
        bs('Niepewności'),
        bt(' - często zgłaszane przez szefów projektów oczekiwania wykraczają poza strefę doświadczenia zespołu inżynierów. Dodatkowo opisane problemy, które należy rozwiązać są przedstawione bez kontekstu i/lub bez wystarczającej ilości informacji. Inżynierowie są postawieni w sytuacji, w której ich strefa dyskomfortu znacznie przewyższa strefę komfortu. Presja czasu i oczekiwanie przedstawienia kilku wariantów, ze wstępną wizualizacją i planem akcji powiększają tę dysproporcję.'),
      ],
      [
        bs('Obawy przed pomyłką '),
        bt('- doświadczeni i odpowiedzialni inżynierowie bardzo niechętnie dzielą się pomysłami, które mają być przedstawione klientom, bez wstępnej weryfikacji. To zrozumiałe. Ich obawa, że podane rozwiązania są wątpliwe, słabe i nie prowadzą do rozwiązania problemu może być jak najbardziej realna - szczególnie jeżeli poruszają się w nowych, nieanalizowanych wcześniej obszarach.'),
      ],
      [
        bs('Demotywacji'),
        bt(' - wynikającej z niemożliwości spełnienia oczekiwań szefów projektów, którzy chcą gotowego rozwiązania, z planem działania i listą szczegółów „na wczoraj”…'),
      ],
    ],
  },
  {
    type: 'paragraph',
    content: [
      bt('Z pomocą w podobnych sytuacjach przychodzą coraz częściej narzędzia wspierane przez sztuczną inteligencję. Wyzwaniem jest ilość informacji, którą otrzymujemy po wpisaniu kilku pierwszych promptów. Korzystając z ogólnie dostępnych narzędzi otrzymujemy często ogromną ich ilość, które nie przybliżają nas do rozwiązania, czasem wzmagają niepewność, otwierają nowe scenariusze w których łatwo się pogubić, lub proponują rozwiązania, które trudno ocenić jako wartościowe.'),
    ],
  },
  {
    type: 'paragraph',
    content: [
      bt('Przyczyną najczęściej nie jest jakość modeli językowych, ale informacje, które podajemy w zapytaniach. Nie jest to intencjonalne. Często po prostu nie wiemy jakie informacje pomogłyby w otrzymaniu wartościowego pomysłu i/lub action planu. W tym celu potrzebne jest wsparcie (z ang. Facilitation), które polega na przeanalizowaniu tego co wiemy, zadaniu właściwych pytań i weryfikacji czy ilość dostępnych informacji jest wystarczająca do utworzenia wartościowego rozwiązania.'),
    ],
  },
  {
    type: 'paragraph',
    content: [
      bt('Zrozumienie wyzwań stojących przed osobami znajdującymi się w podobnych sytuacjach oraz potrzeba ich wsparcia to główna motywacja do pracy nad aplikacją makemyidea.work.'),
    ],
  },
  {
    type: 'paragraph',
    content: [
      bt('To jest typowa aplikacja MVP, która już działa ale ma przed sobą potencjał na dalszy rozwój. Będzie rozwijana jako samodzielna aplikacja lub inne aplikacje tworzone w ramach inicjatywy aremai.tech.'),
    ],
  },
  {
    type: 'paragraph',
    content: [bt('Aplikacja ta pomaga '), bs('nazwać problem'), bt(', który należy '), bs('rozwiązać'), bt('.')],
  },
  {
    type: 'paragraph',
    content: [bt('Zadaje '), bs('pytania'), bt(', które pomagają '), bs('rozwiązać problem'), bt('.')],
  },
  {
    type: 'paragraph',
    content: [bt('Przygotowuje '), bs('plan akcji'), bt(', który jest '), bs('gotowy'), bt(' do pokazania szefowi projektu.')],
  },
  {
    type: 'paragraph',
    content: [bt('Pozwala przygotować '), bs('wizualizację rozwiązania'), bt('.')],
  },
  {
    type: 'paragraph',
    content: [
      bt('Jest tym czego '),
      bs('potrzebujesz'),
      bt(' kiedy masz '),
      bs('mało czasu'),
      bt(', o'),
      bs('graniczoną ilość informacji'),
      bt(', szukasz '),
      bs('wsparcia'),
      bt(' bo czujesz, że '),
      bs('utknąłeś'),
      bt('…'),
    ],
  },
]

export const blogArticleNeedBetterQuestionsEn: BlogArticleBlock[] = [
  {
    type: 'paragraph',
    content: [bt('What do project managers bring to engineers? Most often:')],
  },
  {
    type: 'list',
    items: [
      [bt('A '), bs('problem'), bt(' identified by a client (external or internal),')],
      [bt('A '), bs('vague'), bt(' '), bs('description'), bt(' of the situation,')],
      [
        bt('The expectation of finding an alternative '),
        bs('solution'),
        bt(' that is cheaper without losing functionality or with added features,'),
      ],
      [
        bt('A question about how to '),
        bs('test'),
        bt(' something in order to address the client’s question or concern.'),
      ],
    ],
  },
  {
    type: 'paragraph',
    content: [bt('What do project managers expect from engineers?')],
  },
  {
    type: 'list',
    items: [
      [
        bs('At least a few ideas'),
        bt(' - they want alternatives and the ability to choose from several options. A situation where only one solution is available is uncomfortable because it doesn’t give the sense of choosing the optimal solution. Quite the opposite. Presenting the only possible path raises the suspicion that it’s an ineffective solution. And it’s hard to argue with that when there’s nothing to compare it to.'),
      ],
      [
        bs('Quick feedback'),
        bt(' - in a situation where the client is waiting for an answer, patience is a scarce resource. Any amount of time cited as necessary to prepare a meaningful response seems too long from the client’s perspective. If we add to this the impact of the global market and competition from the Asian market - which is, not without reason, perceived as significantly more dynamic than the European and American markets - the demand for a quick response becomes even more critical.'),
      ],
      [
        bs('An action plan'),
        bt(' - presenting a few ideas in a relatively short time without outlining at least a few immediate steps leading to the final solution - also fails to meet the project manager’s needs. It’s a good start, but without an implementation plan, the project manager often cannot assess the quality of the ideas, not knowing how they are to be verified or not seeing the first visualizations of the solution.'),
      ],
    ],
  },
  {
    type: 'paragraph',
    content: [bt('What situation does this put engineers in?')],
  },
  {
    type: 'list',
    items: [
      [
        bs('Uncertainty'),
        bt(' - the expectations frequently communicated by project managers often extend beyond the engineering team’s area of expertise. Additionally, the problems described that need to be solved are presented without context and/or without sufficient information. Engineers are placed in a situation where their discomfort zone significantly outweighs their comfort zone. Time pressure and the expectation to present several options, complete with preliminary visualizations and an action plan, exacerbate this imbalance.'),
      ],
      [
        bs('Fear of making a mistake'),
        bt(' - experienced and responsible engineers are very reluctant to share ideas intended for clients without prior verification. This is understandable. Their fear that the proposed solutions are questionable, weak, and won’t solve the problem may be very real - especially if they’re venturing into new, previously unexplored areas.'),
      ],
      [
        bs('Demotivation'),
        bt(' - resulting from the inability to meet the expectations of project managers who want a ready-made solution, with an action plan and a list of details “for yesterday”…'),
      ],
    ],
  },
  {
    type: 'paragraph',
    content: [
      bt('AI-powered tools are increasingly coming to the rescue in such situations. The challenge lies in the volume of information we receive after entering the first few prompts. When using publicly available tools, we often get an overwhelming amount of data that doesn’t bring us any closer to a solution; sometimes it increases uncertainty, opens up new scenarios where it’s easy to get lost, or suggests solutions that are hard to assess as valuable.'),
    ],
  },
  {
    type: 'paragraph',
    content: [
      bt('The cause is usually not the quality of the language models, but the information we provide in our queries. This is not intentional. Often, we simply don’t know what information would help us generate a valuable idea and/or action plan. To address this, we need facilitation - a process that involves analyzing what we know, asking the right questions, and verifying whether the available information is sufficient to create a valuable solution.'),
    ],
  },
  {
    type: 'paragraph',
    content: [
      bt('Understanding the challenges faced by people in similar situations and the need to support them is the main motivation behind the development of the makemyidea.work app.'),
    ],
  },
  {
    type: 'paragraph',
    content: [
      bt('This is a typical MVP app that is already up and running but has potential for further development. It will be developed as a standalone app or as part of other apps created under the aremai.tech initiative.'),
    ],
  },
  {
    type: 'paragraph',
    content: [bt('This app helps '), bs('identify the problem'), bt(' that needs to be solved.')],
  },
  {
    type: 'paragraph',
    content: [bt('It asks '), bs('questions'), bt(' that help '), bs('solve the problem'), bt('.')],
  },
  {
    type: 'paragraph',
    content: [bt('It prepares an '), bs('action plan'), bt(' that’s '), bs('ready'), bt(' to present to the project manager.')],
  },
  {
    type: 'paragraph',
    content: [bt('It allows you to create a '), bs('visualization'), bt(' of the solution.')],
  },
  {
    type: 'paragraph',
    content: [
      bt('It’s exactly what you '),
      bs('need'),
      bt(' when you’re '),
      bs('short on time'),
      bt(', have '),
      bs('limited information'),
      bt(', or are looking for '),
      bs('support'),
      bt(' because you feel stuck…'),
    ],
  },
]

export const blogArticleSalesPitchPl: BlogArticleBlock[] = [
  {
    type: 'paragraph',
    content: [
      bt('„Jestem sprzedawcą. Pracuję w firmie produkującej podgrzewacze wody / bojlery. Moja firma oferuje produkty w szerokim zakresie rozmiarów i mocy grzewczych. Jestem na spotkaniu z potencjalnym klientem, który chce bojler ale nie w kształcie cylindra tylko prostopadłościanu. Wszystkie nasze bojlery są cylindryczne. Potrzeba klienta wynika ze specyficznego miejsca zabudowy i potrzeby podgrzania jak największej objętości wody w dostępnej przestrzeni. Nie mamy procesu produkcyjnego który może wyprodukować zbiornik w takim kształcie. Dodatkowo klient chce mieć możliwość łatwej rewizji wnętrza zbiornika. W tej chwili nasze zbiorniki mają połączenie kołnierzowe z kilkunastoma śrubami - takie połączeni nie jest szybkie i łatwe do otwierania i zamykania. Potrzebuję zaproponować mu inne rozwiązanie. Ponadto klient chce użyć energii bezpośrednio z fotowoltaiki, którą posiada. Nie wiem czy nasze rozwiązania przyłączeniowe do sieci elektrycznej mogą to zrealizować. Klient chce kupić 100 zbiorników i otrzymać je za miesiąc. Nasze moce produkcyjne standardowych zbiorników spełniają ten warunek, nie wiem ile potrzebujemy czasu żeby zrobić te w kształcie prostopadłościanu. Nasz zespół technologów jest raczej konserwatywny. Jeżeli nie przedstawię im jakichś pierwszych pomysłów albo planu działania na proces produkcyjny prostopadłościennych zbiorników, to będą udowadniać że tego nie da się zrobić. Klient zaakceptuje cenę wyższa o 20% w stosunku do klasycznego cylindrycznego zbiornika.”'),
    ],
  },
  {
    type: 'paragraph',
    content: [
      bt('To opis potrzeby… nie ma w nim '),
      bs('ani jednego pomysłu'),
      bt(' na jej zaspokojenie. Ale potrzeba jest '),
      bs('konkretna'),
      bt('. Opis obecnej sytuacji również. Co może zrobić sprzedawca? Co ma zaraportować swojemu szefowi po powrocie do biura?'),
    ],
  },
  { type: 'paragraph', content: [bt('Scenariuszy jest conajmniej kilka.')] },
  { type: 'paragraph', content: [bt('Jeden z nich jest taki.')] },
  {
    type: 'paragraph',
    content: [
      bt('Po spotkaniu sprzedawca '),
      bs('przygotowuje plan działania'),
      bt(', opisujący proces uruchomienia produkcji dla specyficznego kształtu bojlera. Plan działania, który może wyglądać tak jak poniższy, '),
      bs('przygotował w samochodzie na parkingu - zajęło mu to 15 minut'),
      bt(' i przedstawił go t'),
      bs('ego samego dnia'),
      bt(' swojemu przełożonemu.'),
    ],
  },
  {
    type: 'section',
    className: 'blog-action-plan',
    blocks: [
  { type: 'paragraph', content: [bs('Plan działania.')] },
  {
    type: 'list',
    ordered: true,
    start: 1,
    items: [[bt('Zbuduj pilotażową linię produkcyjną zbiorników prostopadłościennych.')]],
  },
  {
    type: 'paragraph',
    content: [
      bi('Pilotaż pozwoli zweryfikować techniczne wyzwania i koszty zmiany kształtu zbiornika przed pełnym wdrożeniem. Nie warto jeszcze optymalizować produkcji seryjnej ani skracać czasu realizacji.'),
    ],
  },
  {
    type: 'list',
    level: 1,
    items: [
      [bt('Zaprojektuj i uruchom ograniczoną serię zbiorników prostopadłościennych')],
      [bt('Zmierz koszty i czas produkcji pilotażowej partii')],
    ],
  },
  {
    type: 'lineGroup',
    lines: [
      [
        bs('Największa niewiadoma'),
        bt(': Wysokie koszty i wydłużony czas pilotażu mogą opóźnić decyzję o dalszej skali, a niedoszacowanie problemów technologicznych zaburzy plan.'),
      ],
      [
        bs('Szukasz sygnału'),
        bt(': Czy pilotażowa produkcja jest technicznie wykonalna i czy koszty mieszczą się w założonym budżecie?'),
      ],
      [
        bs('Jeśli to się potwierdzi'),
        bt(': Podejmij decyzję o rozszerzeniu produkcji lub modyfikacji procesu w oparciu o wyniki pilotażu'),
      ],
    ],
  },
  {
    type: 'list',
    ordered: true,
    start: 2,
    items: [[bt('Przetestuj współpracę z zewnętrznymi ekspertami od nietypowych zbiorników.')]],
  },
  {
    type: 'paragraph',
    content: [
      bi('Zewnętrzne know-how może przyspieszyć rozwój i ograniczyć ryzyka technologiczne przy wdrażaniu nowego kształtu. Nie należy jeszcze rezygnować z własnych prób pilotażowych.'),
    ],
  },
  {
    type: 'list',
    level: 1,
    items: [
      [bt('Wyselekcjonuj i zaangażuj firmy z doświadczeniem w produkcji zbiorników nietypowych kształtów')],
      [bt('Przeprowadź konsultacje i ocenę rozwiązań technologicznych')],
    ],
  },
  {
    type: 'lineGroup',
    lines: [
      [
        bs('Największa niewiadoma'),
        bt(': Niedopasowanie kompetencji zewnętrznych firm lub koszty konsultacji mogą przewyższyć korzyści, co trzeba monitorować.'),
      ],
      [
        bs('Szukasz sygnału'),
        bt(': Czy zewnętrzni eksperci dostarczają wartościowe rozwiązania obniżające ryzyko i koszty wdrożenia?'),
      ],
      [
        bs('Jeśli to się potwierdzi'),
        bt(': Zadecyduj o kontynuacji współpracy lub poszukaj innych partnerów technologicznych'),
      ],
    ],
  },
  {
    type: 'list',
    ordered: true,
    start: 3,
    items: [[bt('Przetestuj systemy szybkiego łączenia i modułowej konstrukcji zbiornika.')]],
  },
  {
    type: 'paragraph',
    content: [
      bi('Łatwość rewizji wnętrza jest kluczowa dla serwisu i utrzymania zbiorników. Warto zweryfikować prostotę montażu i demontażu zanim zmienimy proces produkcji na większą skalę.'),
    ],
  },
  {
    type: 'list',
    level: 1,
    items: [
      [bt('Zaprojektuj i zbuduj prototypy połączeń zatrzaskowych i modułowych elementów')],
      [bt('Zmierz czas i złożoność montażu/demontażu w porównaniu do tradycyjnych kołnierzy')],
    ],
  },
  {
    type: 'lineGroup',
    lines: [
      [
        bs('Największa niewiadoma'),
        bt(': Nowe systemy łączeń mogą wymagać zmiany konstrukcji i procesów, co zwiększa złożoność i koszty, jeśli nie zostaną dobrze przetestowane.'),
      ],
      [
        bs('Szukasz sygnału'),
        bt(': Czy nowe rozwiązania skracają czas rewizji i są proste w obsłudze bez specjalistycznych narzędzi?'),
      ],
      [
        bs('Jeśli to się potwierdzi'),
        bt(': Wprowadź system szybkiego łączenia do kolejnych iteracji lub popraw prototypy'),
      ],
    ],
  },
  {
    type: 'list',
    ordered: true,
    start: 4,
    items: [[bt('Monitoruj terminowość realizacji zamówień podczas wdrażania nowych procesów.')]],
  },
  {
    type: 'paragraph',
    content: [
      bi('Wdrożenie nowych procesów może wydłużyć czas realizacji, co może negatywnie wpłynąć na klienta. Trzeba kontrolować terminy i szybko reagować na opóźnienia.'),
    ],
  },
  {
    type: 'list',
    level: 1,
    items: [
      [bt('Wprowadź etapową produkcję z pomiarem czasu realizacji na każdym kroku')],
      [bt('Analizuj przyczyny opóźnień i eliminuj je na bieżąco')],
    ],
  },
  {
    type: 'lineGroup',
    lines: [
      [
        bs('Największa niewiadoma'),
        bt(': Zbyt długie opóźnienia mogą zniechęcić klientów, nawet jeśli produkt spełnia wymagania kształtu.'),
      ],
      [
        bs('Szukasz sygnału'),
        bt(': Czy czas realizacji mieści się w akceptowalnych granicach mimo nowego procesu produkcji?'),
      ],
      [
        bs('Jeśli to się potwierdzi'),
        bt(': Dostosuj proces lub zasoby aby utrzymać akceptowalny czas realizacji'),
      ],
    ],
  },
    ],
  },
  { type: 'paragraph', content: [bt('Brzmi prawdopodobnie?')] },
  {
    type: 'paragraph',
    content: [
      bt('Jeżeli sprzedawca '),
      bs('użył aplikacji'),
      bt(' makemyidea.work, a do wygenerowania planu akcji '),
      bs('użył opisu z początku artykułu'),
      bt('… to nie tylko prawdopodobny scenariusz ale przede wszystkim '),
      bs('prawdziwy'),
      bt(' i '),
      bs('pewny'),
      bt('.'),
    ],
  },
]

export const blogArticleSalesPitchEn: BlogArticleBlock[] = [
  {
    type: 'paragraph',
    content: [
      bt('“I’m a salesperson. I work for a company that manufactures water heaters. My company offers products in a wide range of sizes and heating capacities. I’m in a meeting with a potential customer who wants a boiler, but not a cylindrical one - a rectangular one instead. All our boilers are cylindrical. The customer’s need stems from a specific installation location and the requirement to heat as much water as possible within the available space. We do not have a production process capable of manufacturing a tank in that shape. Additionally, the customer wants the ability to easily inspect the interior of the tank. Currently, our tanks have a flanged connection with a dozen or so bolts - such a connection is not quick or easy to open and close. I need to propose an alternative solution to him. Furthermore, the customer wants to use energy directly from the photovoltaic system they own. I’m not sure if our grid connection solutions can accommodate this. The customer wants to purchase 100 tanks and receive them in a month. Our production capacity for standard tanks meets this requirement, but I don’t know how much time we’ll need to make the rectangular ones. Our engineering team is rather conservative. If I don’t present them with some initial ideas or an action plan for the production process of rectangular tanks, they’ll argue that it can’t be done. The customer will accept a price that is 20% higher than that of a standard cylindrical tank.”'),
    ],
  },
  {
    type: 'paragraph',
    content: [
      bt('This is a description of a need… it doesn’t contain '),
      bs('a single idea'),
      bt(' for how to meet it. But the need is '),
      bs('specific'),
      bt('. So is the description of the current situation. What can the salesperson do? What should they report to their boss when they return to the office?'),
    ],
  },
  { type: 'paragraph', content: [bt('There are at least a few possible scenarios.')] },
  { type: 'paragraph', content: [bt('One of them is as follows.')] },
  {
    type: 'paragraph',
    content: [
      bt('After the meeting, the salesperson prepares '),
      bs('an action plan'),
      bt(' describing the process of launching production for a specific boiler model. The action plan, which might look like the one below, was '),
      bs('prepared in his car in the parking lot - it took him 15 minutes'),
      bt(', and he presented it to his supervisor '),
      bs('that same day'),
      bt('.'),
    ],
  },
  {
    type: 'section',
    className: 'blog-action-plan',
    blocks: [
      { type: 'paragraph', content: [bs('Action Plan'), bt('.')] },
      {
        type: 'list',
        ordered: true,
        start: 1,
        items: [[bt('Build a pilot production line for rectangular tanks.')]],
      },
      {
        type: 'paragraph',
        content: [
          bi('The pilot will help identify technical challenges and the costs associated with changing the tank’s shape before full implementation. It is not yet advisable to optimize mass production or reduce lead times.'),
        ],
      },
      {
        type: 'list',
        level: 1,
        items: [
          [bt('Design and launch a limited series of rectangular tanks')],
          [bt('Measure the costs and production time of the pilot batch')],
        ],
      },
      {
        type: 'lineGroup',
        lines: [
          [
            bs('The biggest unknown'),
            bt(': High costs and extended pilot time may delay the decision to scale up, and underestimating technological challenges will disrupt the plan.'),
          ],
          [
            bs('You’re looking for a signal'),
            bt(': Is pilot production technically feasible, and do the costs stay within the budget?'),
          ],
          [
            bs('If this is confirmed'),
            bt(': Make a decision to expand production or modify the process based on the pilot results'),
          ],
        ],
      },
      {
        type: 'list',
        ordered: true,
        start: 2,
        items: [[bt('Test collaboration with external experts in non-standard tanks')]],
      },
      {
        type: 'paragraph',
        content: [
          bi('External expertise can accelerate development and mitigate technological risks when implementing a new shape. However, you should not yet abandon your own pilot tests.'),
        ],
      },
      {
        type: 'list',
        level: 1,
        items: [
          [bt('Select and engage companies with experience in manufacturing non-standard tank shapes')],
          [bt('Conduct consultations and evaluate technological solutions')],
        ],
      },
      {
        type: 'lineGroup',
        lines: [
          [
            bs('The biggest unknown'),
            bt(': A mismatch in external companies’ expertise or the costs of consultation may outweigh the benefits, which must be monitored.'),
          ],
          [
            bs('Look for a signal'),
            bt(': Do external experts provide valuable solutions that reduce implementation risks and costs?'),
          ],
          [
            bs('If this is confirmed'),
            bt(': Decide to continue the collaboration or look for other technology partners'),
          ],
        ],
      },
      {
        type: 'list',
        ordered: true,
        start: 3,
        items: [[bt('Test quick-connect systems and modular tank designs')]],
      },
      {
        type: 'paragraph',
        content: [
          bi('Easy access to the interior is crucial for tank servicing and maintenance. It is advisable to verify the ease of assembly and disassembly before scaling up the production process.'),
        ],
      },
      {
        type: 'list',
        level: 1,
        items: [
          [bt('Design and build prototypes of snap-fit and modular components')],
          [bt('Measure the time and complexity of assembly/disassembly compared to traditional flanges')],
        ],
      },
      {
        type: 'lineGroup',
        lines: [
          [
            bs('The biggest unknown'),
            bt(': New connection systems may require changes to design and processes, which increases complexity and costs if they are not thoroughly tested.'),
          ],
          [
            bs('Look for the signal'),
            bt(': Do the new solutions reduce revision time and are they easy to use without specialized tools?'),
          ],
          [
            bs('If this is confirmed'),
            bt(': Introduce the quick-connect system into subsequent iterations or refine the prototypes'),
          ],
        ],
      },
      {
        type: 'list',
        ordered: true,
        start: 4,
        items: [[bt('Monitor order fulfillment timelines during the implementation of new processes')]],
      },
      {
        type: 'paragraph',
        content: [
          bi('Implementing new processes can extend lead times, which may negatively impact customers. You need to monitor deadlines and respond quickly to delays.'),
        ],
      },
      {
        type: 'list',
        level: 1,
        items: [
          [bt('Implement phased production with lead time tracking at every stage')],
          [bt('Analyze the causes of delays and address them as they arise')],
        ],
      },
      {
        type: 'lineGroup',
        lines: [
          [
            bs('The biggest unknown'),
            bt(': Excessively long delays can discourage customers, even if the product meets the design requirements.'),
          ],
          [
            bs('Look for a signal'),
            bt(': Is the lead time within acceptable limits despite the new production process?'),
          ],
          [
            bs('If this is confirmed'),
            bt(': Adjust the process or resources to maintain an acceptable lead time'),
          ],
        ],
      },
    ],
  },
  { type: 'paragraph', content: [bt('Sound plausible?')] },
  {
    type: 'paragraph',
    content: [
      bt('If you used the makemyidea.work app and used the description from the beginning of the article to generate an action plan… this is not only a plausible scenario but, above all, a real and certain one.'),
    ],
  },
]

export const blogArticleAiWeekendPl: BlogArticleBlock[] = [
  {
    type: 'paragraph',
    content: [
      bt('Piątek, godzina 14h00. Większość zespołu już jest myślami na weekendzie. Dzwoni szef i mówi:„Dzwonię do Ciebie bo jesteś najbardziej doświadczonym szefem projektów w naszej firmie, '),
      bs('potrzebuję plan działania, kilka pomysłów jak zacząć projekt, którego celem będzie znalezienie alternatywnego rozwiązania dla połączenia śrubowego stosowanego przy połączeniach rur z kołnierzami. Chodzi o przewody rurowe stosowane w różnych branżach do transportu cieczy.'),
      bt('  W poniedziałek o 10h00 jest spotkanie z zarządem, na którym chce to przedstawić. Dasz radę? Mogę na Ciebie liczyć?”'),
    ],
  },
  {
    type: 'paragraph',
    content: [
      bt('Pomijając manipulację zastosowaną przez przełożonego - jak zareaguje pracownik? Conajmniej na kilka sposobów. Od próby wynegocjowania większej ilości czasu przez pracę w weekend kończąc na… no właśnie, jakie jeszcze pozostają opcje?'),
    ],
  },
  {
    type: 'paragraph',
    content: [
      bt('Jednym z coraz częściej stosowanych narzędzi w takich sytuacjach jest AI. Wyzwanie polega na '),
      bs('zadaniu właściwych pytań'),
      bt(' i segregacji otrzymanych wyników. W ograniczeniu tego typu problemów '),
      bs('pomagają dedykowane aplikacje'),
      bt('. Jedną z nich jest makemyidea.work.'),
    ],
  },
  {
    type: 'paragraph',
    content: [
      bt('Po wprowadzeniu '),
      bs('minimalnej ilości informacji'),
      bt(' - w tym przypadku to pogrubiony tekst na początku artykułu - aplikacja '),
      bs('zadaje kilka pytań'),
      bt(', które pomagają lepiej '),
      bs('zrozumieć kontekst'),
      bt(', a następnie '),
      bs('przygotowuje plan działania'),
      bt('.'),
    ],
  },
  { type: 'paragraph', content: [bt('Zadane pytania przez aplikację i odpowiedzi udzielone przez szefa projektu to:')] },
  {
    type: 'qaList',
    pairs: [
      {
        question: [
          bs('P'),
          bt(': Jakie ryzyka pojawiają się, gdy skracany jest czas montażu połączeń kołnierzowych, a jednocześnie brak jest pełnej kontroli nad równomiernością dokręcenia śrub?'),
        ],
        answer: [
          bs('O'),
          bt(': Głównym ryzykiem jest brak szczelności połączenia, który może się pojawić po jakimś czasie dla małych wycieków.'),
        ],
      },
      {
        question: [
          bs('P'),
          bt(': Jakie kryteria musi spełniać alternatywne połączenie kołnierzowe, aby uznać je za skuteczną i bezpieczną zamianę dla połączenia śrubowego?'),
        ],
        answer: [
          bs('O'),
          bt(': Najważniejszym kryterium jest szczelność polaczenia, która nie może być obniżona.'),
        ],
      },
      {
        question: [
          bs('P'),
          bt(': Jak obecne ograniczenia dostępu do śrub wpływają na częstotliwość i rodzaj awarii podczas eksploatacji połączeń kołnierzowych?'),
        ],
        answer: [bs('O'), bt(': Te dane nie są udostępniane przez naszych klientów.')],
      },
      {
        question: [
          bs('P'),
          bt(': Jakie kompromisy musisz zaakceptować, jeśli chcesz skrócić czas montażu połączeń kołnierzowych bez zwiększania ryzyka niewłaściwego dokręcenia śrub?'),
        ],
        answer: [bs('O'), bt(': Nie wiem')],
      },
      {
        question: [
          bs('P'),
          bt(': W jakich sytuacjach lub warunkach montaż i demontaż połączeń śrubowych kołnierzy sprawiają najwięcej trudności lub generują największe ryzyko awarii?'),
        ],
        answer: [
          bs('O'),
          bt(': W sytuacjach kiedy nie ma łatwego dostępu do wszystkich śrub i niektóre z nich mogą być nie właściwie dokręcone.'),
        ],
      },
      {
        question: [
          bs('P'),
          bt(': Jakie są największe problemy i ograniczenia związane z obecnym połączeniem śrubowym kołnierzy, które motywują poszukiwanie alternatywy?'),
        ],
        answer: [bs('O'), bt(': Czas montażu i demontażu połączenia.')],
      },
    ],
  },
  { type: 'paragraph', content: [bt('To pozwoliło na utworzenie poniższego planu działania.')] },
  {
    type: 'section',
    className: 'blog-action-plan',
    blocks: [
      { type: 'paragraph', content: [bs('Plan działania.')] },
      {
        type: 'list',
        ordered: true,
        start: 1,
        items: [[bt('Zbuduj prototyp narzędzia do automatycznego dokręcania śrub z czujnikami momentu')]],
      },
      {
        type: 'paragraph',
        content: [
          bi('Automatyzacja dokręcania jest kluczowa dla skrócenia czasu montażu przy zachowaniu szczelności. Wczesny prototyp pozwoli ocenić dokładność i powtarzalność ustawień momentu.'),
        ],
      },
      {
        type: 'list',
        level: 1,
        items: [
          [bt('Zbuduj prosty prototyp narzędzia z czujnikiem momentu dokręcania')],
          [bt('Przetestuj powtarzalność i sygnalizację poprawności dokręcenia w warunkach warsztatowych')],
        ],
      },
      {
        type: 'lineGroup',
        lines: [
          [bs('Największa niewiadoma'), bt(': Ryzyko nadmiernej złożoności i kosztów narzędzia, które może nie spełnić wymagań montażowych lub wymagać zbyt częstej kalibracji.')],
          [bs('Szukasz sygnału'), bt(': Czy prototyp zapewnia powtarzalne i wiarygodne sygnały potwierdzające poprawność dokręcenia?')],
          [bs('Jeśli to się potwierdzi'), bt(': Zdecyduj, czy narzędzie jest gotowe do integracji testowej lub wymaga modyfikacji')],
        ],
      },
      {
        type: 'list',
        ordered: true,
        start: 2,
        items: [[bt('Przetestuj i porównaj szybkozłącza i bezśrubowe systemy uszczelniające')]],
      },
      {
        type: 'paragraph',
        content: [
          bi('Szybkozłącza mogą radykalnie skrócić czas montażu, ale wymagają potwierdzenia szczelności i trwałości w warunkach montażowych i eksploatacyjnych.'),
        ],
      },
      {
        type: 'list',
        level: 1,
        items: [
          [bt('Dobierz i zamów kilka typów szybko złączy z uszczelnieniem do testów')],
          [bt('Przeprowadź testy szczelności i trwałości pod obciążeniem i przy symulowanym montażu')],
        ],
      },
      {
        type: 'lineGroup',
        lines: [
          [bs('Największa niewiadoma'), bt(': Możliwość, że nowe złącza nie spełnią standardów szczelności, co wymusi powrót do tradycyjnych śrub lub zwiększy koszty testów i certyfikacji.')],
          [bs('Szukasz sygnału'), bt(': Czy szybkozłącza utrzymują wymagany poziom szczelności i mechanicznej wytrzymałości?')],
          [bs('Jeśli to się potwierdzi'), bt(': Wybierz szybkozłącza, które spełniają kryteria do dalszych testów integracyjnych lub odrzuć je')],
        ],
      },
      {
        type: 'list',
        ordered: true,
        start: 3,
        items: [[bt('Zaprojektuj i wykonaj mechanizm samoregulujących się połączeń z równomiernym rozłożeniem sił')]],
      },
      {
        type: 'paragraph',
        content: [
          bi('Eliminacja konieczności precyzyjnego dokręcania śrub zmniejszy błędy montażowe i pozwoli na szybszą produkcję bez utraty szczelności.'),
        ],
      },
      {
        type: 'list',
        level: 1,
        items: [
          [bt('Zaprojektuj koncepcję samoregulującego połączenia')],
          [bt('Wykonaj i przetestuj prototyp pod kątem rozkładu sił i szczelności')],
        ],
      },
      {
        type: 'lineGroup',
        lines: [
          [bs('Największa niewiadoma'), bt(': Mechanizm może zwiększyć masę i koszt elementów lub wprowadzić komplikacje w produkcji, co wymaga wczesnego prototypowania i testów.')],
          [bs('Szukasz sygnału'), bt(': Czy prototyp zapewnia równomierne rozłożenie obciążeń i spełnia wymogi szczelności?')],
          [bs('Jeśli to się potwierdzi'), bt(': Podejmij decyzję o kontynuacji rozwoju lub poszukaj uproszczeń')],
        ],
      },
      {
        type: 'list',
        ordered: true,
        start: 4,
        items: [[bt('Sprawdź integrację czujników monitorujących stan dokręcenia w warunkach ograniczonego dostępu')]],
      },
      {
        type: 'paragraph',
        content: [
          bi('W miejscach o trudnym dostępie czujniki mogą zapobiec błędom montażowym i zmniejszyć konieczność ręcznej kontroli.'),
        ],
      },
      {
        type: 'list',
        level: 1,
        items: [
          [bt('Zainstaluj czujniki w prototypowych połączeniach o ograniczonym dostępie')],
          [bt('Przetestuj działanie i niezawodność czujników podczas symulowanego montażu')],
        ],
      },
      {
        type: 'lineGroup',
        lines: [
          [bs('Największa niewiadoma'), bt(': Możliwe problemy z trwałością i kalibracją czujników w trudnych warunkach, co może wymagać dodatkowych zabezpieczeń lub redundancji.')],
          [bs('Szukasz sygnału'), bt(': Czy czujniki niezawodnie wykrywają nieprawidłowe dokręcenie i są odporne na zakłócenia montażowe?')],
          [bs('Jeśli to się potwierdzi'), bt(': Oceń, czy czujniki mogą być standardem montażowym czy wymagają zmian')],
        ],
      },
      {
        type: 'list',
        ordered: true,
        start: 5,
        items: [[bt('Przetestuj i zaimplementuj elementy prefabrykowane zintegrowane z rurami oraz złącza klikające')]],
      },
      {
        type: 'paragraph',
        content: [
          bi('Redukcja liczby połączeń do montażu i szybkie łączenia klikające mogą znacznie skrócić czas montażu i ograniczyć błędy.'),
        ],
      },
      {
        type: 'list',
        level: 1,
        items: [
          [bt('Przygotuj prefabrykowane segmenty rur z wbudowanymi elementami łączeniowymi')],
          [bt('Przetestuj szybkość i niezawodność połączeń klikających podczas montażu')],
        ],
      },
      {
        type: 'lineGroup',
        lines: [
          [bs('Największa niewiadoma'), bt(': Prefabrykacja może zwiększyć logistykę i koszty przygotowania oraz wymaga potwierdzenia kompatybilności ze wszystkimi elementami systemu.')],
          [bs('Szukasz sygnału'), bt(': Czy prefabrykowane elementy i złącza klikające redukują czas montażu bez utraty jakości i szczelności?')],
          [bs('Jeśli to się potwierdzi'), bt(': Zdecyduj o rozszerzeniu prefabrykacji lub adaptacji złączy klikających na kolejne moduły')],
        ],
      },
    ],
  },
  {
    type: 'paragraph',
    content: [
      bt('Cały proces zajął około '),
      bs('15-20 minut'),
      bt('. Szef projektu wysłał plan działania do przełożonego o 14:30, więc ten drugi miał czas go przeanalizować i przygotować się do spotkania w poniedziałek.'),
    ],
  },
]

export const blogArticleAiWeekendEn: BlogArticleBlock[] = [
  {
    type: 'paragraph',
    content: [
      bt('Friday, 2:00 p.m. Most of the team is already thinking about the weekend. The boss calls and says, “I’m calling you because you’re the most experienced project manager in our company. '),
      bs('I need an action plan and a few ideas on how to start a project aimed at finding an alternative solution to the bolted joint used in flanged pipe connections. This involves piping used in various industries for transporting liquids'),
      bt('. There’s a meeting with the board on Monday at 10:00 a.m., where he wants to present this. Can you handle it? Can I count on you?”'),
    ],
  },
  {
    type: 'paragraph',
    content: [
      bt('Setting aside the manipulation employed by the supervisor - how might an employee respond? In at least a few ways. From trying to negotiate more time by working over the weekend to… well, what other options are there?'),
    ],
  },
  {
    type: 'paragraph',
    content: [
      bt('One of the increasingly common tools used in such situations is AI. The challenge lies in '),
      bs('asking the right questions'),
      bt(' and filtering the results. '),
      bs('Dedicated apps help'),
      bt(' mitigate these types of problems. One of them is makemyidea.work.'),
    ],
  },
  {
    type: 'paragraph',
    content: [
      bt('After entering a '),
      bs('minimal amount of information'),
      bt(' - in this case, the bold text at the beginning of the article - the application '),
      bs('asks a few questions'),
      bt(' to help better '),
      bs('understand the context'),
      bt(', and then '),
      bs('prepares an action plan'),
      bt('.'),
    ],
  },
  { type: 'paragraph', content: [bt('The questions asked by the app and the answers provided by the project manager are as follows:')] },
  {
    type: 'qaList',
    pairs: [
      {
        question: [
          bs('Q'),
          bt(': What risks arise when the installation time for flanged joints is shortened, yet there is no full control over the uniformity of bolt tightening?'),
        ],
        answer: [
          bs('A'),
          bt(': The main risk is a leak in the joint, which may occur after some time due to small leaks.'),
        ],
      },
      {
        question: [
          bs('Q'),
          bt(': What criteria must an alternative flange connection meet to be considered an effective and safe replacement for a bolted connection?'),
        ],
        answer: [
          bs('A'),
          bt(': The most important criterion is the tightness of the connection, which must not be compromised.'),
        ],
      },
      {
        question: [
          bs('Q'),
          bt(': How do current restrictions on access to bolts affect the frequency and type of failures during the operation of flanged connections?'),
        ],
        answer: [bs('A'), bt(': This data is not shared by our customers.')],
      },
      {
        question: [
          bs('Q'),
          bt(': What compromises must you accept if you want to reduce the installation time for flange connections without increasing the risk of improper bolt tightening?'),
        ],
        answer: [bs('A'), bt(': I don’t know')],
      },
      {
        question: [
          bs('Q'),
          bt(': In what situations or conditions does the installation and disassembly of flange bolted connections pose the greatest difficulties or generate the highest risk of failure?'),
        ],
        answer: [
          bs('A'),
          bt(': In situations where not all bolts are easily accessible and some of them may be improperly tightened.'),
        ],
      },
      {
        question: [
          bs('Q'),
          bt(': What are the biggest problems and limitations associated with the current flange bolted joint that are driving the search for an alternative?'),
        ],
        answer: [bs('A'), bt(': The time required to assemble and disassemble the joint.')],
      },
    ],
  },
  { type: 'paragraph', content: [bt('Then, below action plan has been created automatically.')] },
  {
    type: 'section',
    className: 'blog-action-plan',
    blocks: [
      { type: 'paragraph', content: [bs('Action plan.')] },
      {
        type: 'list',
        ordered: true,
        start: 1,
        items: [[bt('Build a prototype of an automatic bolt-tightening tool with torque sensors.')]],
      },
      {
        type: 'paragraph',
        content: [
          bi('Automating the tightening process is key to reducing assembly time while maintaining a tight seal. An early prototype will allow you to evaluate the accuracy and repeatability of the torque settings.'),
        ],
      },
      {
        type: 'list',
        level: 1,
        items: [
          [bt('Build a simple prototype of a tool with a torque sensor')],
          [bt('Test repeatability and torque confirmation signals under workshop conditions')],
        ],
      },
      {
        type: 'lineGroup',
        lines: [
          [bs('The biggest unknown'), bt(': The risk of excessive tool complexity and cost, which may fail to meet assembly requirements or require too frequent calibration.')],
          [bs('What you’re looking for'), bt(': Does the prototype provide repeatable and reliable signals confirming proper tightening?')],
          [bs('If this is confirmed'), bt(': Decide whether the tool is ready for test integration or requires modification')],
        ],
      },
      {
        type: 'list',
        ordered: true,
        start: 2,
        items: [[bt('Test and compare quick-connect and screw-less sealing systems.')]],
      },
      {
        type: 'paragraph',
        content: [
          bi('Quick-connect systems can drastically reduce assembly time, but their leak-tightness and durability must be verified under assembly and operating conditions.'),
        ],
      },
      {
        type: 'list',
        level: 1,
        items: [
          [bt('Select and order several types of sealed quick-connect fittings for testing')],
          [bt('Conduct leak and durability tests under load and in simulated installation conditions')],
        ],
      },
      {
        type: 'lineGroup',
        lines: [
          [bs('The biggest unknown'), bt(': The possibility that the new fittings will not meet leak-tightness standards, which would force a return to traditional bolts or increase testing and certification costs.')],
          [bs('Look for a signal'), bt(': Do the quick-release couplings maintain the required level of leak tightness and mechanical strength?')],
          [bs('If confirmed'), bt(': Select the quick-release couplings that meet the criteria for further integration testing or reject them')],
        ],
      },
      {
        type: 'list',
        ordered: true,
        start: 3,
        items: [[bt('Design and build a self-adjusting connection mechanism with even force distribution')]],
      },
      {
        type: 'paragraph',
        content: [
          bi('Eliminating the need for precise bolt tightening will reduce assembly errors and allow for faster production without compromising leak tightness.'),
        ],
      },
      {
        type: 'list',
        level: 1,
        items: [
          [bt('Design a self-adjusting connection concept')],
          [bt('Build and test a prototype for force distribution and leak tightness')],
        ],
      },
      {
        type: 'lineGroup',
        lines: [
          [bs('The biggest unknown'), bt(': The mechanism may increase the weight and cost of components or introduce complications in production, which requires early prototyping and testing.')],
          [bs('Look for a signal'), bt(': Does the prototype ensure even load distribution and meet leak tightness requirements?')],
          [bs('If confirmed'), bt(': Decide whether to proceed with development or look for ways to simplify the design')],
        ],
      },
      {
        type: 'list',
        ordered: true,
        start: 4,
        items: [[bt('Test the integration of torque monitoring sensors in hard-to-reach areas')]],
      },
      {
        type: 'paragraph',
        content: [
          bi('In hard-to-reach areas, sensors can prevent assembly errors and reduce the need for manual inspection.'),
        ],
      },
      {
        type: 'list',
        level: 1,
        items: [
          [bt('Install sensors in prototype connections with limited access')],
          [bt('Test the sensors’ performance and reliability during simulated assembly')],
        ],
      },
      {
        type: 'lineGroup',
        lines: [
          [bs('The biggest unknown'), bt(': Potential issues with sensor durability and calibration in harsh conditions, which may require additional safeguards or redundancy.')],
          [bs('Looking for a signal'), bt(': Do the sensors reliably detect improper tightening and are they resistant to assembly interference?')],
          [bs('If confirmed'), bt(': Evaluate whether the sensors can become a standard assembly feature or require modifications')],
        ],
      },
      {
        type: 'list',
        ordered: true,
        start: 5,
        items: [[bt('Test and implement prefabricated components integrated with pipes and click-fit connectors.')]],
      },
      {
        type: 'paragraph',
        content: [
          bi('Reducing the number of connections required for installation and using quick-connect click-fit joints can significantly shorten installation time and minimize errors.'),
        ],
      },
      {
        type: 'list',
        level: 1,
        items: [
          [bt('Prepare prefabricated pipe segments with built-in connectors')],
          [bt('Test the speed and reliability of click-to-connect joints during installation')],
        ],
      },
      {
        type: 'lineGroup',
        lines: [
          [bs('The biggest unknown'), bt(': Prefabrication may increase logistics and preparation costs and requires confirmation of compatibility with all system components.')],
          [bs('You’re looking for a sign'), bt(': Do prefabricated components and click-to-connect joints reduce installation time without compromising quality and leak-tightness?')],
          [bs('If this is confirmed'), bt(': Decide to expand prefabrication or adapt click-to-connect joints to additional modules')],
        ],
      },
    ],
  },
  {
    type: 'paragraph',
    content: [
      bt('The entire process took about '),
      bs('15–20 minutes'),
      bt('. The project manager sent the action plan to the boss at 2:30 PM, so the boss had time to review it and prepare for the meeting on Monday.'),
    ],
  },
]
