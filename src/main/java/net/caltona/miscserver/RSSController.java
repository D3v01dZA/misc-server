package net.caltona.miscserver;

import lombok.AllArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.dom4j.Document;
import org.dom4j.DocumentException;
import org.dom4j.Element;
import org.dom4j.io.SAXReader;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.client.RestTemplate;

import java.net.MalformedURLException;
import java.net.URL;
import java.util.*;

@Slf4j
@RestController
@AllArgsConstructor
public class RSSController {

    @Autowired
    private RestTemplate restTemplate;

    @GetMapping(value = "/rss", produces = "text/xml; charset=UTF-8")
    public String rss(
            @RequestParam String url,
            @RequestParam(required = false) List<String> filter,
            @RequestParam(required = false) List<String> excludetext,
            @RequestParam(required = false) List<String> includetext
    ) throws DocumentException, MalformedURLException {
        List<Filter> filters = parseFilters(url, filter, excludetext, includetext);
        SAXReader saxReader = new SAXReader();
        Document root = saxReader.read(new URL(url));
        Element rootElement = root.getRootElement();
        for (Element elementToDelete : findElementsToDelete(url, filters, rootElement)) {
            rootElement.remove(elementToDelete);
        }
        return root.asXML();
    }

    private List<Filter> parseFilters(String url, List<String> filter, List<String> excludeText, List<String> includeText) {
        List<Filter> filters = new ArrayList<>();
        if (filter != null) {
            for (String value : filter) {
                if (value.equalsIgnoreCase("shorts")) {
                    ShortsFilter shortsFilter = new ShortsFilter();
                    log.info("RSS URL [{}] added filter [{}]", url, shortsFilter);
                    filters.add(shortsFilter);
                }
                if (value.equalsIgnoreCase("country")) {
                    CountryFilter countryFilter = new CountryFilter();
                    log.info("RSS URL [{}] added filter [{}]", url, countryFilter);
                    filters.add(countryFilter);
                }
            }
        }
        if (excludeText != null) {
            for (String value : excludeText) {
                ExcludeTextFilter excludeTextFilter = new ExcludeTextFilter(value.toLowerCase());
                log.info("RSS URL [{}] added filter [{}]", url, excludeTextFilter);
                filters.add(excludeTextFilter);
            }
        }
        if (includeText != null) {
            for (String value : includeText) {
                IncludeTextFilter includeTextFilter = new IncludeTextFilter(value.toLowerCase());
                log.info("RSS URL [{}] added filter [{}]", url, includeTextFilter);
                filters.add(includeTextFilter);
            }
        }
        return filters;
    }

    public interface Filter {

        boolean shouldFilter(String url, String description, Element element);

    }

    private Set<Element> findElementsToDelete(String url, List<Filter> filters, Element rootElement) {
        Set<Element> elementsToDelete = new HashSet<>();
        Set<String> remaining = new LinkedHashSet<>();
        Set<String> removed = new LinkedHashSet<>();
        for (Element element : rootElement.elements()) {
            if (element.getName().equals("entry")) {
                Element title = element.element("title");
                String description = title != null ? title.getText() : "No Title";
                boolean filtered = false;
                for (Filter filter : filters) {
                    if (filter.shouldFilter(url, description, element)) {
                        log.info("RSS URL [{}] [{}] filtered because of [{}]", url, description, filter);
                        filtered = true;
                    } else {
                        log.info("RSS URL [{}] [{}] not filtered because of [{}]", url, description, filter);
                    }
                }
                if (filtered) {
                    elementsToDelete.add(element);
                    removed.add(description);
                } else {
                    remaining.add(description);
                }
            }
        }
        log.info("RSS URL [{}] removed [{}] elements left [{}] remaining with titles removed [{}] and remaining [{}]", url, removed.size(), remaining.size(), removed, remaining);
        return elementsToDelete;
    }

    public class ShortsFilter implements Filter {

        @Override
        public boolean shouldFilter(String url, String description, Element element) {
            Element id = element.element("id");
            if (id != null) {
                String videoId = id.getText();
                if (videoId != null) {
                    String[] split = videoId.split(":");
                    if (split.length == 3) {
                        String actualId = split[2];
                        log.debug("RSS URL [{}] [{}] found actual video id [{}]", url, description, actualId);
                        if (isShort(actualId)) {
                            log.debug("RSS URL [{}] [{}] found short [{}]", url, description, actualId);
                            return true;
                        } else {
                            log.debug("RSS URL [{}] [{}] found video [{}]", url, description, actualId);
                        }
                    } else {
                        log.warn("RSS URL [{}] [{}] entry has a malformed id in [{}]", url, description, id.asXML());
                    }
                } else {
                    log.warn("RSS URL [{}] [{}] entry has no video id in [{}]", url, description, id.asXML());
                }
            } else {
                log.debug("RSS URL [{}] [{}] entry has no id in [{}]", url, description, element.asXML());
            }
            return false;
        }

        private boolean isShort(String videoId) {
            HttpHeaders headers = restTemplate.headForHeaders("https://www.youtube.com/shorts/" + videoId);
            return !headers.containsKey("location");
        }

        @Override
        public String toString() {
            return "ShortsFilter{}";
        }
    }

    @AllArgsConstructor
    public class ExcludeTextFilter implements Filter {

        private String text;

        @Override
        public boolean shouldFilter(String url, String description, Element element) {
            return element.asXML().toLowerCase().contains(text);
        }

        @Override
        public String toString() {
            return "ExcludeTextFilter{" +
                    "text='" + text + '\'' +
                    '}';
        }
    }

    @AllArgsConstructor
    public class IncludeTextFilter implements Filter {

        private String text;

        @Override
        public boolean shouldFilter(String url, String description, Element element) {
            return !element.asXML().toLowerCase().contains(text);
        }

        @Override
        public String toString() {
            return "IncludeTextFilter{" +
                    "text='" + text + '\'' +
                    '}';
        }
    }

    @AllArgsConstructor
    public class CountryFilter implements Filter {

        @Override
        public boolean shouldFilter(String url, String description, Element element) {
            Element id = element.element("id");
            if (id != null) {
                String videoId = id.getText();
                if (videoId != null) {
                    String[] split = videoId.split(":");
                    if (split.length == 3) {
                        String actualId = split[2];
                        log.debug("RSS URL [{}] [{}] found actual video id [{}]", url, description, actualId);
                        if (isAvailable(actualId)) {
                            log.debug("RSS URL [{}] [{}] found short [{}]", url, description, actualId);
                            return true;
                        } else {
                            log.debug("RSS URL [{}] [{}] found video [{}]", url, description, actualId);
                        }
                    } else {
                        log.warn("RSS URL [{}] [{}] entry has a malformed id in [{}]", url, description, id.asXML());
                    }
                } else {
                    log.warn("RSS URL [{}] [{}] entry has no video id in [{}]", url, description, id.asXML());
                }
            } else {
                log.debug("RSS URL [{}] [{}] entry has no id in [{}]", url, description, element.asXML());
            }
            return false;
        }

        private boolean isAvailable(String id) {
            String text = restTemplate.getForObject("https://www.youtube.com/watch?v=" + id, String.class);
            return text != null && !text.contains("The uploader has not made this video available in your country");
        }

        @Override
        public String toString() {
            return "CountryFilter{}";
        }
    }

}
