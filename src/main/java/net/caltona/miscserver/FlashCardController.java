package net.caltona.miscserver;

import lombok.*;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.yaml.snakeyaml.Yaml;

import java.io.*;
import java.util.*;
import java.util.function.BiConsumer;
import java.util.stream.Collectors;
import java.util.stream.Stream;

@Slf4j
@RestController
public class FlashCardController {

    private static final Random RANDOM = new Random();

    private final Map<String, List<Combo>> combosByName;

    private final Map<String, List<Integer>> weightsByName;

    private final Map<String, Writer> outputsByName;

    public FlashCardController(@Value("${misc.cards.combosdirectory}") String directory,
                               @Value("${misc.cards.resultsdirectory}") String resultsDirectory) throws IOException {
        this.combosByName = new TreeMap<>();
        this.weightsByName = new HashMap<>();
        this.outputsByName = new HashMap<>();
        File dir = new File(directory);
        if (!dir.exists() || !dir.isDirectory()) {
            throw new IllegalStateException(String.format("Directory %s does not exist", directory));
        }
        File[] files = dir.listFiles((__, name) -> name.endsWith(".yaml"));
        if (files == null || files.length == 0) {
            throw new IllegalStateException(String.format("Directory %s contains no files", directory));
        }
        Yaml yaml = new Yaml();
        for (File file : files) {
            Container loaded = yaml.loadAs(new FileReader(file), Container.class);
            if (loaded == null) {
                throw new IllegalStateException(String.format("Null container for %s", file.getName()));
            }
            loaded.check();

            String key = file.getName().replace(".yaml", "");
            combosByName.put(key, loaded.getCombos());

            List<Integer> weights = loaded.getCombos().stream().map(__ -> 1).collect(Collectors.toCollection(ArrayList::new));
            weightsByName.put(key, weights);

            String weightsFile = resultsDirectory + "/" + key + ".dmp";
            Writer writer = new Writer(weightsFile);
            outputsByName.put(key, writer);
            writer.read((question, difficulty) -> addWeight(key, weights, question, difficulty));
        }
    }

    @GetMapping(value = "/card")
    public String card(@RequestParam(required = false) String list,
                       @RequestParam(required = false) Integer question,
                       @RequestParam(required = false) Integer difficulty,
                       @RequestParam(required = false) String stat) {
        if (list == null) {
            return listHTML();
        }
        List<Combo> combos = combosByName.get(list);
        Writer writer = outputsByName.get(list);
        if (combos == null || writer == null) {
            return listHTML();
        }
        if (stat != null) {
            return statHTML(list, stat, combos, writer);
        }
        return cardHTML(list, combos, weightsByName.get(list), writer, question, difficulty);
    }

    private String statHTML(String list, String stat, List<Combo> combos, Writer writer) {
        log.info("Stat");
        List<String> errors = new ArrayList<>();
        List<Stat> stats = new ArrayList<>();
        for (int i = 0; i < combos.size(); i++) {
            stats.add(new Stat(i + 1, 0, 0, 0, 0));
        }
        writer.read((question, difficulty) -> {
            boolean error = false;
            if (question < 0) {
                errors.add("Question < 0");
                error = true;
            }
            if (question >= combos.size()) {
                errors.add("Question > " + combos.size());
                error = true;
            }
            if (difficulty < 1) {
                errors.add("Difficulty < 1");
                error = true;
            }
            if (difficulty > 3) {
                errors.add("Difficulty > 3");
                error = true;
            }
            if (!error && difficulty == 1) {
                stats.get(question).wrong();
            }
            if (!error && difficulty == 2) {
                stats.get(question).hard();
            }
            if (!error && difficulty == 3) {
                stats.get(question).easy();
            }
        });
        if (stat.equals("questions")) {
            // No sorting
        } else if (stat.equals("total")) {
            Collections.sort(stats, Comparator.<Stat>comparingInt(one -> one.total).reversed());
        } else if (stat.equals("wrong")) {
            Collections.sort(stats, Comparator.<Stat>comparingInt(one -> one.wrong).reversed());
        } else if (stat.equals("hard")) {
            Collections.sort(stats, Comparator.<Stat>comparingInt(one -> one.hard).reversed());
        } else if (stat.equals("easy")) {
            Collections.sort(stats, Comparator.<Stat>comparingInt(one -> one.easy).reversed());
        } else {
            errors.add("Unknown stat " + stat);
        }
        return String.format("<html>" +
                        "   <head>" +
                        "       <title>Flash Card - %s Stats</title>" +
                        "   </head>" +
                        "   <body>" +
                        "       <div style='height: 100%%;display: flex;justify-content: center;align-items: center;flex-direction: column;'>" +
                        "           <div style='display: flex;justify-content: center;align-items: center;flex-direction: row;'>" +
                        "               <button style='font-size: 2em;' id='total' onclick='redirect(\"questions\")'>Question</button>" +
                        "               <button style='font-size: 2em;' id='total' onclick='redirect(\"total\")'>Total</button>" +
                        "               <button style='font-size: 2em;' id='wrong' onclick='redirect(\"wrong\")'>Wrong</button>" +
                        "               <button style='font-size: 2em;' id='hard' onclick='redirect(\"hard\")'>Hard</button>" +
                        "               <button style='font-size: 2em;' id='easy' onclick='redirect(\"easy\")'>Easy</button>" +
                        "           </div>" +
                        "           <h2 style='font-size: 6em;'>Stats</h2>" +
                        "           %s" +
                        "           %s" +
                        "           <script>" +
                        "               function redirect(stat) {" +
                        "                   const params = new URLSearchParams(window.location.search);" +
                        "                   params.set('stat', stat);" +
                        "                   window.location.search = params;" +
                        "               }" +
                        "           </script>" +
                        "       </div>" +
                        "   </body>" +
                        "</html>",
                list,
                "<p style='overflow:scroll;font-size: 2em;'>" + stats.stream()
                        .map(single -> String.format("Question: %s Total %s: Wrong %s: Hard %s: Easy %s", single.question, single.total, single.wrong, single.hard, single.easy))
                        .collect(Collectors.joining("<br/>")) + "</p>",
                errors.isEmpty() ? "" : "<h2>Errors</h2>" + "<p>" + String.join("<br/>", errors) + "</p>"
        );
    }

    private String listHTML() {
        log.info("List");
        return String.format("<html>" +
                        "   <head>" +
                        "       <title>Flash Card List</title>" +
                        "   </head>" +
                        "   <body>" +
                        "       <div style='height: 100%%;display: flex;justify-content: center;align-items: center;flex-direction: column;'>" +
                        "           <h2 style='font-size: 6em;'>Lists</h2>" +
                        "           %s" +
                        "           <script>" +
                        "               function redirect(url) {" +
                        "                   const params = new URLSearchParams(window.location.search);" +
                        "                   params.set('list', url);" +
                        "                   window.location.search = params;" +
                        "               }" +
                        "               function redirectstats(url) {" +
                        "                   const params = new URLSearchParams(window.location.search);" +
                        "                   params.set('list', url);" +
                        "                   params.set('stat', 'questions');" +
                        "                   window.location.search = params;" +
                        "               }" +
                        "           </script>" +
                        "       </div>" +
                        "   </body>" +
                        "</html>",
                combosByName.keySet().stream()
                        .flatMap(list -> Stream.of(
                                String.format("<button style='font-size: 2em;' onclick='redirect(\"%s\")'>%s</button>", list, "Quiz - " + capitalize(list)),
                                String.format("<button style='font-size: 2em;' onclick='redirectstats(\"%s\")'>%s</button>", list, "Stats - " + capitalize(list))
                        ))
                        .collect(Collectors.joining())
        );
    }

    private String cardHTML(String list, List<Combo> combos, List<Integer> weights, Writer writer, Integer question, Integer difficulty) {
        log.info("List {} card {} difficulty {}", list, question, difficulty);

        List<String> errors = new ArrayList<>();
        if (difficulty != null || question != null) {
            if (question == null) {
                errors.add("Question was null");
            }
            if (question != null && question < 0) {
                errors.add("Question was < 0");
            }
            if (question != null && question > combos.size() - 1) {
                errors.add("Question was > " + (combos.size() - 1));
            }
            if (difficulty == null) {
                errors.add("Difficulty was null");
            }
            if (difficulty != null && difficulty < 1) {
                errors.add("Difficulty was < 1");
            }
            if (difficulty != null && difficulty > 3) {
                errors.add("Difficulty was > 3");
            }
        }

        if (question != null && difficulty != null && errors.isEmpty()) {
            addWeight(list, weights, question, difficulty);
            writer.write(question, difficulty);
        }
        int selected = applyWeights(weights);
        Combo combo = combos.get(selected);
        return String.format("<html>" +
                        "   <head>" +
                        "       <title>Flash Card Test - %s</title>" +
                        "   </head>" +
                        "   <body>" +
                        "       <div style='height: 100%%;display: flex;justify-content: center;align-items: center;flex-direction: column;text-align: center;'>" +
                        "           <h2 style='font-size: 6em;'>%s</h2>" +
                        "           <button style='font-size: 2em;' id='ansbtn' onclick='answer()'>Answer</button>" +
                        "           <div id='ans' style='display:none'>" +
                        "               <h3 style='font-size: 3em;text-align: center;'>%s</h3>" +
                        "               <div style='display: flex;justify-content: center;align-items: center;flex-direction: row;'>" +
                        "                   <button style='font-size: 2em;' id='wrong' onclick='redirect(1)'>Wrong</button>" +
                        "                   <button style='font-size: 2em;' id='hard' onclick='redirect(2)'>Hard</button>" +
                        "                   <button style='font-size: 2em;' id='easy' onclick='redirect(3)'>Easy</button>" +
                        "               </div>" +
                        "           </div>" +
                        "           %s" +
                        "           <script>" +
                        "               function answer() {" +
                        "                   document.querySelector('#ansbtn').style.display = 'none';" +
                        "                   document.querySelector('#ans').style.display = 'block';" +
                        "               }" +
                        "               function redirect(difficulty) {" +
                        "                   const params = new URLSearchParams(window.location.search);" +
                        "                   params.set('question', '%s');" +
                        "                   params.set('difficulty', difficulty);" +
                        "                   window.location.search = params;" +
                        "               }" +
                        "           </script>" +
                        "       </div>" +
                        "   </body>" +
                        "</html>",
                capitalize(list),
                combo.getQuestion(),
                "<p>" + String.join("<br/>", combo.getAnswers()) + "</p>",
                errors.isEmpty() ? "" : "<h2>Errors</h2>" + "<p>" + String.join("<br/>", errors) + "</p>",
                selected
        );
    }

    private static void addWeight(String list, List<Integer> weights, Integer question, Integer difficulty) {
        int addedWeight = -1;
        if (difficulty == 1) {
            addedWeight = 0; // If wrong don't make the question any less likely
        }
        if (difficulty == 2) {
            addedWeight = 3; // If hard make the question less likely
        }
        if (difficulty == 3) {
            addedWeight = 15; // If easy make the question way less likely
        }
        int currentWeight = weights.get(question);
        log.info("List {} adding {} weight to question {}", list, addedWeight, currentWeight);
        weights.set(question, currentWeight + addedWeight);
    }

    private int applyWeights(List<Integer> weights) {
        int modifier = weights.stream()
                .mapToInt(__ -> __)
                .max()
                .getAsInt();
        List<Integer> computed = weights.stream()
                .map(weight -> Math.abs(modifier - weight) + 1)
                .toList();
        int sum = computed.stream()
                .mapToInt(__ -> __)
                .sum();
        int selected = RANDOM.nextInt(sum);
        int current = 0;
        for (int i = 0; i < computed.size(); i++) {
            current += computed.get(i);
            if (current > selected) {
                return i;
            }
        }
        throw new IllegalStateException("Could not compute a weight");
    }

    private String capitalize(final String line) {
        return Character.toUpperCase(line.charAt(0)) + line.substring(1);
    }

    @AllArgsConstructor
    public class Writer {

        private String file;

        public void write(int question, int difficulty) {
            File actual = new File(file);
            if (!actual.exists()) {
                try {
                    if (!actual.createNewFile()) {
                        throw new IllegalStateException("Could not create " + file);
                    }
                } catch (IOException e) {
                    throw new RuntimeException(e);
                }
            }
            try (FileWriter fileWriter = new FileWriter(actual, true)) {
                fileWriter.write(question + "," + difficulty + "\n");
            } catch (IOException e) {
                throw new RuntimeException(e);
            }
        }

        public void read(BiConsumer<Integer, Integer> questionDifficultyConsumer) {
            File actual = new File(file);
            if (actual.exists()) {
                try (BufferedReader reader = new BufferedReader(new FileReader(actual))) {
                    String line;
                    while ((line = reader.readLine()) != null) {
                        boolean error = false;
                        try {
                            if (line.contains(",")) {
                                String[] split = line.split(",");
                                if (split.length != 2) {
                                    error = true;
                                }
                                int question = Integer.parseInt(split[0]);
                                int weight = Integer.parseInt(split[1]);
                                questionDifficultyConsumer.accept(question, weight);
                            } else if (!line.isEmpty()) {
                                error = true;
                            }
                        } catch (NumberFormatException ex) {
                            error = true;
                        }
                        if (error) {
                            log.warn("Unknown line {} encountered while reading {}", line, file);
                        }
                    }
                } catch (IOException e) {
                    throw new RuntimeException(e);
                }
            }
        }

    }

    @Data
    public static class Container {

        private List<Combo> combos;

        private void check() {
            if (combos == null || combos.isEmpty()) {
                throw new IllegalStateException("Empty combos");
            }
            for (Combo combo : combos) {
                if (combo == null) {
                    throw new IllegalStateException("Null combo");
                }
                combo.check();
            }
        }

    }

    @Data
    public static class Combo {

        private String question;
        private List<String> answers;

        private void check() {
            if (question == null || question.trim().isEmpty()) {
                throw new IllegalStateException("Null question");
            }
            if (answers == null || answers.isEmpty()) {
                throw new IllegalStateException("Empty combos");
            }
            for (String answer : answers) {
                if (answer == null || answer.trim().isEmpty()) {
                    throw new IllegalStateException("Null answer");
                }
            }
        }

    }

    @Getter
    @AllArgsConstructor
    public static class Stat {

        private int question;
        private int total;
        private int wrong;
        private int hard;
        private int easy;

        public void wrong() {
            total++;
            wrong++;
        }

        public void hard() {
            total++;
            hard++;
        }

        public void easy() {
            total++;
            easy++;
        }

    }

}
